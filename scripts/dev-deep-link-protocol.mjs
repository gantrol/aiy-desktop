import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const clientPath = fileURLToPath(new URL('./dev-deep-link-client.cjs', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const supportedOperations = new Set(['register', 'unregister']);

export function updateDevDeepLinkProtocol(operation, electronExecutable) {
  if (!supportedOperations.has(operation)) {
    console.error('[deep-link] Expected register or unregister.');
    return 1;
  }
  if (!electronExecutable) {
    console.error('[deep-link] Electron executable is required.');
    return 1;
  }
  if (process.platform !== 'win32') {
    console.error('[deep-link] Development protocol management is currently supported on Windows only.');
    return 1;
  }

  const result = spawnSync(electronExecutable, [clientPath, operation], {
    cwd: repositoryRoot,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) {
    console.error(`[deep-link] Failed to launch the ${operation} helper.`, result.error);
    return 1;
  }
  return result.status ?? 1;
}
