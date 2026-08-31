import path from 'node:path';
import { BROWSER_COMPANION_DATA_DIRECTORY_NAME } from '@/shared/product';

export function resolveBrowserCompanionDataPath({
  appDataRoot,
  configuredUserDataPath,
}: {
  appDataRoot: string;
  configuredUserDataPath: string | undefined;
}): string {
  const override = configuredUserDataPath?.trim();
  if (override) return path.join(path.resolve(override), 'browser-companion');
  return path.join(path.resolve(appDataRoot), BROWSER_COMPANION_DATA_DIRECTORY_NAME);
}
