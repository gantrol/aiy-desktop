import { resolveBrowserCompanionDataPath } from '@/main/browser-companion/data-path';
import { BrowserCompanionHandoffStore } from '@/main/browser-companion/handoff-store';
import { runBrowserCompanionNativeHost } from '@/main/browser-companion/native-host';
import { browserCompanionNativeOrigin } from '@/main/browser-companion/protocol';

async function main(): Promise<void> {
  const origin = browserCompanionNativeOrigin(process.argv);
  if (!origin) throw new Error('Chrome extension origin argument is missing');
  const appDataRoot = process.env.APPDATA?.trim();
  if (!appDataRoot) throw new Error('APPDATA is unavailable');

  const dataPath = resolveBrowserCompanionDataPath({
    appDataRoot,
    configuredUserDataPath: process.env.AIY_USER_DATA_DIR,
  });
  const store = new BrowserCompanionHandoffStore(dataPath);
  await runBrowserCompanionNativeHost({
    origin,
    store,
    stdin: process.stdin,
    stdout: process.stdout,
  });
}

void main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((reason: unknown) => {
    const detail = reason instanceof Error ? reason.message : String(reason);
    process.stderr.write('[browser-companion] ' + detail + '\n');
    process.exitCode = 1;
  });
