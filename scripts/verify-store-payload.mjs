import { lstat, open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

// Update together with win.electronLanguages and the language-extension guide
// when adding a supported Electron locale. Keep the English fallback.
const electronLocales = ['en-US.pak', 'zh-CN.pak'];
const losslessWebpImages = [
  'first',
  'settled',
  'monitor',
  'character',
  'roses-original',
  'smile-02',
  'smile-03',
  'smile-04',
  'smile-05',
  'smile-06',
  'smile-07',
  'smile-08',
];

async function readAsarAssets(asarPath) {
  const file = await open(asarPath, 'r');
  try {
    // ASAR stores an eight-byte size pickle followed by a JSON header pickle.
    // Read only the bounded index, never the media payload.
    const size = Buffer.alloc(8);
    if ((await file.read(size, 0, size.length, 0)).bytesRead !== size.length) {
      throw new Error('Packaged ASAR size header is incomplete.');
    }
    const headerSize = size.readUInt32LE(4);
    if (headerSize < 8 || headerSize > 16 * 1024 * 1024) {
      throw new Error('Packaged ASAR index exceeds its supported bounds.');
    }
    const header = Buffer.alloc(headerSize);
    if ((await file.read(header, 0, header.length, 8)).bytesRead !== header.length) {
      throw new Error('Packaged ASAR index is incomplete.');
    }
    const jsonSize = header.readUInt32LE(4);
    if (jsonSize > header.length - 8) throw new Error('Packaged ASAR JSON size is invalid.');
    const index = JSON.parse(header.toString('utf8', 8, 8 + jsonSize));
    const assets = index.files?.out?.files?.renderer?.files?.assets?.files;
    if (!assets) throw new Error('Packaged renderer assets are missing.');
    return assets;
  } finally {
    await file.close();
  }
}

async function requireNoDuplicateDemoAssets(payloadRoot) {
  const duplicatePath = path.join(payloadRoot, 'resources/extensions/com.aiy.feature-demo/assets');
  try {
    await lstat(duplicatePath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('Demo assets were copied to extraResources; their runtime copies already belong to app.asar.');
}

async function verifyPayload(payloadRoot) {
  const [locales, icu, assets] = await Promise.all([
    readdir(path.join(payloadRoot, 'locales'), { withFileTypes: true }),
    stat(path.join(payloadRoot, 'icudtl.dat')),
    readAsarAssets(path.join(payloadRoot, 'resources/app.asar')),
    requireNoDuplicateDemoAssets(payloadRoot),
  ]);
  const actualLocales = locales.map((entry) => entry.name).sort();
  if (
    locales.some((entry) => !entry.isFile()) ||
    actualLocales.length !== electronLocales.length ||
    actualLocales.some((name) => !electronLocales.includes(name))
  ) {
    throw new Error(
      `Unexpected Electron locales: ${actualLocales.join(', ')}. Expected ${electronLocales.join(', ')}.`,
    );
  }
  if (!icu.isFile() || !icu.size) throw new Error('The shared Electron ICU data must remain packaged.');

  const names = Object.keys(assets);
  for (const stem of losslessWebpImages) {
    const matching = (extension) => names.filter((name) => name.startsWith(`${stem}-`) && name.endsWith(extension));
    if (matching('.png').length) throw new Error(`Authoring PNG for ${stem} was bundled instead of its runtime WebP.`);
    const runtimeNames = matching('.webp');
    if (runtimeNames.length !== 1 || !assets[runtimeNames[0]].size || assets[runtimeNames[0]].unpacked) {
      throw new Error(`Expected one packed lossless WebP runtime image for ${stem}.`);
    }
  }
  // Hand transparency and portrait provenance require their existing PNGs.
  for (const stem of ['hand', 'portrait-1', 'portrait-2', 'portrait-3']) {
    if (!names.some((name) => name.startsWith(`${stem}-`) && name.endsWith('.png') && assets[name].size > 0)) {
      throw new Error(`Required preserved PNG is missing: ${stem}.`);
    }
  }
  console.log('Store payload policy passed: English/Chinese locales, ICU, one demo resource copy and runtime images.');
}

const [payloadRoot, ...extraArguments] = process.argv.slice(2);
if (!payloadRoot || extraArguments.length || /trash/i.test(payloadRoot)) {
  throw new Error('Usage: node scripts/verify-store-payload.mjs <extracted-msix-directory>');
}
await verifyPayload(path.resolve(payloadRoot));
