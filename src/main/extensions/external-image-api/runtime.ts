import type { ExternalImageApiExtensionId } from '@/shared/extension-ids';
import type {
  ExternalImageApiRuntimeConfiguration,
  ExternalImageApiRuntimeStatus,
} from '@/main/extensions/external-image-api/types';

/** Credentials are held only inside the detached model worker. */
export class ExternalImageApiRuntime {
  private readonly configurations = new Map<ExternalImageApiExtensionId, ExternalImageApiRuntimeConfiguration>();

  configure(configurations: readonly ExternalImageApiRuntimeConfiguration[]) {
    this.configurations.clear();
    for (const configuration of configurations) {
      this.configurations.set(configuration.extensionId, {
        ...configuration,
        settings: { ...configuration.settings },
      });
    }
  }

  status(extensionId: ExternalImageApiExtensionId): ExternalImageApiRuntimeStatus {
    const configuration = this.configurations.get(extensionId);
    if (!configuration) {
      return {
        configured: false,
        usable: false,
        verified: false,
        message: 'API credentials are not configured',
      };
    }
    return {
      configured: true,
      usable: configuration.usable,
      verified: configuration.verified,
      message: configuration.connectionMessage,
    };
  }

  credentials(extensionId: ExternalImageApiExtensionId) {
    const configuration = this.configurations.get(extensionId);
    if (!configuration?.usable) {
      throw new Error(configuration?.connectionMessage || 'Image API connection is not ready');
    }
    return {
      apiKey: configuration.apiKey,
      settings: { ...configuration.settings },
      verified: configuration.verified,
    };
  }

  clear() {
    this.configurations.clear();
  }
}
