import path from 'node:path';
import { STORE_USER_DATA_DIRECTORY_NAME, USER_DATA_DIRECTORY_NAME } from '@/shared/product';

export function resolveAiyUserDataPath({
  appDataRoot,
  configuredPath,
  windowsStore,
}: {
  appDataRoot: string;
  configuredPath: string | undefined;
  windowsStore: boolean;
}): string {
  const override = configuredPath?.trim();
  if (override) return path.resolve(override);
  return path.resolve(appDataRoot, windowsStore ? STORE_USER_DATA_DIRECTORY_NAME : USER_DATA_DIRECTORY_NAME);
}
