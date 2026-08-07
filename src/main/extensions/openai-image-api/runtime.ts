import type {
  OpenAiImageApiRuntimeConfiguration,
  OpenAiImageApiRuntimeStatus,
} from '@/main/extensions/openai-image-api/types';

/** In-memory-only credential boundary owned by the detached model worker. */
export class OpenAiImageApiRuntime {
  private configuration: OpenAiImageApiRuntimeConfiguration | null = null;

  configure(configuration: OpenAiImageApiRuntimeConfiguration | null) {
    this.configuration = configuration ? { ...configuration } : null;
  }

  status(): OpenAiImageApiRuntimeStatus {
    if (!this.configuration) {
      return {
        configured: false,
        usable: false,
        verified: false,
        message: 'OpenAI API credentials are not configured',
      };
    }
    return {
      configured: true,
      usable: this.configuration.usable,
      verified: this.configuration.verified,
      message: this.configuration.connectionMessage,
    };
  }

  credentials() {
    const configuration = this.configuration;
    if (!configuration?.usable)
      throw new Error(configuration?.connectionMessage || 'OpenAI API connection is not ready');
    return {
      apiKey: configuration.apiKey,
      organizationId: configuration.organizationId,
      projectId: configuration.projectId,
    };
  }

  imageRequestOptions() {
    return {
      moderation: this.configuration?.moderation ?? 'auto',
    };
  }

  clear() {
    this.configuration = null;
  }
}
