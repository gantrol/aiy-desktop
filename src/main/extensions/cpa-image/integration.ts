import type { ExternalImageApiRuntimeConfiguration } from '@/main/extensions/external-image-api/types';
import type { CpaImageConnection } from '@/main/extensions/cpa-image/connection';
import { CPA_IMAGE_API_EXTENSION_ID } from '@/shared/extension-ids';

interface ActivationPermissions {
  isActivated(extensionId: string): boolean;
  isPermissionGranted(extensionId: string, permission: string): boolean;
}

export function cpaImageExtensionStatus(connection: CpaImageConnection, extensions: ActivationPermissions) {
  const status = connection.status();
  const permission = connection.endpointPermission();
  const authorized = !permission || extensions.isPermissionGranted(CPA_IMAGE_API_EXTENSION_ID, permission);
  return {
    configured: status.configured,
    usable: authorized && (status.connectionState === 'READY' || status.connectionState === 'UNVERIFIED'),
    message: status.message,
    permissionRequired: authorized ? null : permission,
  };
}

export function appendCpaImageRuntimeConfiguration(
  configured: ExternalImageApiRuntimeConfiguration[],
  connection: CpaImageConnection,
  extensions: ActivationPermissions,
) {
  const permission = connection.endpointPermission();
  if (
    extensions.isActivated(CPA_IMAGE_API_EXTENSION_ID) &&
    (!permission || extensions.isPermissionGranted(CPA_IMAGE_API_EXTENSION_ID, permission))
  ) {
    const cpa = connection.runtimeConfiguration();
    if (cpa) configured.push(cpa);
  }
  return configured;
}

export function refreshCpaImageConnection(
  connection: CpaImageConnection,
  succeeded: boolean,
  refreshRuntime: () => Promise<unknown>,
) {
  void (succeeded ? connection.markVerified() : connection.markAuthError())
    .then(refreshRuntime)
    .catch((error) => console.error('[cpa-image] failed to update connection state', error));
}
