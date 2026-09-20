import type { ExternalImageApiExtensionId } from '@/shared/extension-ids';
import type { CPA_IMAGE_API_EXTENSION_ID } from '@/shared/extension-ids';

export type ImageRuntimeExtensionId = ExternalImageApiExtensionId | typeof CPA_IMAGE_API_EXTENSION_ID;

export interface ExternalImageApiRuntimeConfiguration {
  extensionId: ImageRuntimeExtensionId;
  apiKey: string;
  settings: Record<string, string>;
  usable: boolean;
  verified: boolean;
  connectionMessage: string;
}

export interface ExternalImageApiRuntimeStatus {
  configured: boolean;
  usable: boolean;
  verified: boolean;
  message: string;
}
