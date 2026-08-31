import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateDevDeepLinkProtocol } from './dev-deep-link-protocol.mjs';

const applicationRoot = fileURLToPath(new URL('..', import.meta.url));
const electronVite = path.join(applicationRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js');
const arguments_ = [electronVite, 'dev', '--watch'];
const manageDeepLink = process.argv.slice(2).includes('--deep-link');
let deepLinkRegistered = false;
let electronProcess = null;
let cleanupStarted = false;

function canListen(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function findRendererPort(startPort = 5173, attempts = 200) {
  for (let port = startPort; port < startPort + attempts; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No available renderer port found from ${startPort} to ${startPort + attempts - 1}`);
}

function unregisterDeepLink() {
  if (!deepLinkRegistered) return 0;
  deepLinkRegistered = false;
  return updateDevDeepLinkProtocol('unregister');
}

function stopChild(child) {
  if (!child || child.killed) return;
  child.kill();
}

function cleanUp() {
  if (cleanupStarted) return 0;
  cleanupStarted = true;
  stopChild(electronProcess);
  return unregisterDeepLink();
}

if (manageDeepLink) {
  const registrationExitCode = updateDevDeepLinkProtocol('register');
  if (registrationExitCode !== 0) process.exit(registrationExitCode);
  deepLinkRegistered = true;
}

process.on('exit', cleanUp);
process.on('SIGINT', () => {
  cleanUp();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanUp();
  process.exit(143);
});

let rendererPort;
try {
  rendererPort = await findRendererPort();
  console.info(`[dev] Renderer port: ${rendererPort}`);
} catch (reason) {
  console.error('[dev] Failed to select a renderer port.', reason);
  const cleanupExitCode = cleanUp();
  process.exit(cleanupExitCode || 1);
}

if (process.platform === 'linux') {
  // Ubuntu 24.04 restricts Chromium's unprivileged user namespaces through
  // AppArmor, while an npm-installed chrome-sandbox cannot be setuid root.
  // This affects the development runtime only; packaged BrowserWindow
  // renderers retain their configured Electron sandbox.
  arguments_.push('--noSandbox');
  console.warn('[dev] Chromium process sandbox disabled for the Linux source runtime.');
}

console.info('[dev] Browser companion disabled; starting Electron only.');
electronProcess = spawn(process.execPath, arguments_, {
  env: {
    ...process.env,
    AIY_RENDERER_DEV_PORT: String(rendererPort),
  },
  stdio: 'inherit',
});

electronProcess.on('error', (error) => {
  console.error('[dev] Failed to start electron-vite.', error);
  const cleanupExitCode = cleanUp();
  process.exitCode = cleanupExitCode || 1;
});

electronProcess.on('exit', (code, signal) => {
  const cleanupExitCode = cleanUp();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = (code ?? 1) || cleanupExitCode;
});
