import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') process.exit(0);
const root = fileURLToPath(new URL('..', import.meta.url));
const artwork = path.join(root, 'src/renderer/assets/aiy-reading.png');
const renderer = path.join(root, 'scripts/render-macos-icons.swift');
const icon = path.join(root, 'build/icon-mac.png');
const startupIcon = path.join(root, 'src/renderer/public/icon.png');
const fingerprintFile = path.join(root, '.tmp', 'macos-icon-fingerprint');
const hash = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
const fingerprint = async () => (await Promise.all([artwork, renderer, icon, startupIcon].map(hash))).join('\n');

let upToDate = false;
try {
  const [savedFingerprint, currentFingerprint] = await Promise.all([readFile(fingerprintFile, 'utf8'), fingerprint()]);
  upToDate = savedFingerprint === currentFingerprint;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (upToDate) {
  console.info('[macOS] Application icons are up to date.');
} else {
  await mkdir(path.dirname(fingerprintFile), { recursive: true });
  const child = spawn('xcrun', ['swift', renderer, artwork, icon, startupIcon], {
    windowsHide: true,
    stdio: 'inherit',
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`macOS icon renderer failed (${signal ?? code}).`));
    });
  });
  await writeFile(fingerprintFile, await fingerprint());
  console.info('[macOS] Updated application icons from the current AIY artwork.');
}
