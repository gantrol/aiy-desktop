import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

// Other platforms retain their existing input helper and do not need a Swift toolchain.
if (process.platform !== 'darwin') process.exit(0);
if (process.arch !== 'arm64' && process.arch !== 'x64')
  throw new Error(`Unsupported macOS architecture: ${process.arch}`);

const root = fileURLToPath(new URL('..', import.meta.url));
const sources = ['ControlTapDetector.swift', 'main.swift'].map((name) =>
  path.join(root, 'native', 'petal-input-macos', name),
);
const outputDirectory = path.join(root, '.tmp', 'native', `darwin-${process.arch}`);
const executable = path.join(outputDirectory, 'aiy-petal-input');
const fingerprintFile = path.join(outputDirectory, 'fingerprint');
const run = promisify(execFile);
const [compilerResult, sdkResult] = await Promise.all([
  run('xcrun', ['--find', 'swiftc']),
  run('xcrun', ['--sdk', 'macosx', '--show-sdk-path']),
]);
const compiler = compilerResult.stdout.trim();
const sdk = sdkResult.stdout.trim();
const [compilerStat, ...sourceContents] = await Promise.all([
  stat(compiler),
  ...sources.map((file) => readFile(file, 'utf8')),
]);
const fingerprint = createHash('sha256')
  .update(JSON.stringify([process.arch, compiler, compilerStat.mtimeMs, sdk]))
  .update(sourceContents.join('\n'))
  .digest('hex');

let upToDate = false;
try {
  const [, savedFingerprint] = await Promise.all([access(executable), readFile(fingerprintFile, 'utf8')]);
  upToDate = savedFingerprint === fingerprint;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (upToDate) {
  console.info('[macOS] Petal input helper is up to date.');
} else {
  await mkdir(outputDirectory, { recursive: true });
  const temporary = `${executable}.building`;
  const child = spawn(
    compiler,
    [
      '-O',
      '-target',
      `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx12.0`,
      '-sdk',
      sdk,
      '-module-cache-path',
      path.join(root, '.tmp', 'swift-module-cache'),
      ...sources,
      '-o',
      temporary,
    ],
    { windowsHide: true, stdio: 'inherit' },
  );
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Swift compiler failed (${signal ?? code}).`));
    });
  });
  await chmod(temporary, 0o755);
  await rename(temporary, executable);
  await writeFile(fingerprintFile, fingerprint);
  console.info(`[macOS] Built petal input helper for ${process.arch}.`);
}
