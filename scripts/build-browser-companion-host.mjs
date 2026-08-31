import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postject from 'postject';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const applicationRoot = path.resolve(scriptDirectory, '..');
const temporaryRoot = path.join(applicationRoot, '.tmp');
const outputRoot = path.join(temporaryRoot, 'browser-companion-host');
const bundlePath = path.join(outputRoot, 'native-host.cjs');
const seaConfigPath = path.join(outputRoot, 'sea-config.json');
const seaBlobPath = path.join(outputRoot, 'sea-prep.blob');
const executablePath = path.join(outputRoot, 'aiy-browser-companion-host.exe');
const signToolPath = fileURLToPath(import.meta.resolve('@electron/windows-sign/vendor/signtool.exe'));

if (path.dirname(outputRoot) !== temporaryRoot || outputRoot === applicationRoot) {
  throw new Error('Refusing to replace a native host output directory outside the desktop temporary directory');
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: applicationRoot,
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(new Error('Command failed with code ' + String(code) + ' and signal ' + String(signal)));
      }
    });
  });
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

await build({
  entryPoints: [path.join(applicationRoot, 'src', 'main', 'browser-companion', 'sea-entry.ts')],
  outfile: bundlePath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  minify: true,
  sourcemap: false,
  tsconfig: path.join(applicationRoot, 'tsconfig.json'),
});

await writeFile(
  seaConfigPath,
  JSON.stringify(
    {
      main: bundlePath,
      output: seaBlobPath,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      execArgvExtension: 'none',
    },
    null,
    2,
  ),
  'utf8',
);

await run(process.execPath, ['--experimental-sea-config', seaConfigPath]);
await copyFile(process.execPath, executablePath);
await run(signToolPath, ['remove', '/s', '/q', executablePath]);
await postject.inject(executablePath, 'NODE_SEA_BLOB', await readFile(seaBlobPath), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
});

process.stdout.write(executablePath + '\n');
