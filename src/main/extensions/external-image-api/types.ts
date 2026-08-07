import type { ExternalImageApiExtensionId } from '@/shared/extension-ids';

export interface ExternalImageApiRuntimeConfiguration {
  extensionId: ExternalImageApiExtensionId;
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
