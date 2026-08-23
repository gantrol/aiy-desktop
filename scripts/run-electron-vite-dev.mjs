import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const electronVite = fileURLToPath(new URL('../node_modules/electron-vite/bin/electron-vite.js', import.meta.url));
const arguments_ = [electronVite, 'dev', '--watch'];

if (process.platform === 'linux') {
  // Ubuntu 24.04 restricts Chromium's unprivileged user namespaces through
  // AppArmor, while an npm-installed chrome-sandbox cannot be setuid root.
  // This affects the development runtime only; packaged BrowserWindow
  // renderers retain their configured Electron sandbox.
  arguments_.push('--noSandbox');
  console.warn('[dev] Chromium process sandbox disabled for the Linux source runtime.');
}

const child = spawn(process.execPath, arguments_, { stdio: 'inherit' });

child.on('error', (error) => {
  console.error('[dev] Failed to start electron-vite.', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
