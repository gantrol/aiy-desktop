import type {
  DeepSeekApiConnectionSnapshot,
  DeepSeekApiRuntimeConfiguration,
  DeepSeekApiRuntimeStatus,
} from '@/main/extensions/deepseek-api/types';

/** In-memory-only DeepSeek credential boundary owned by the detached model worker. */
export class DeepSeekApiRuntime {
  private configuration: DeepSeekApiRuntimeConfiguration | null = null;

  configure(configuration: DeepSeekApiRuntimeConfiguration | null) {
    this.configuration = configuration ? { ...configuration } : null;
  }

  status(): DeepSeekApiRuntimeStatus {
    if (!this.configuration) {
      return { configured: false, ready: false, message: 'DeepSeek API credentials are not configured' };
    }
    return {
      configured: true,
      ready: this.configuration.verified,
      message: this.configuration.connectionMessage,
    };
  }

  connectionSnapshot(): DeepSeekApiConnectionSnapshot {
    const configuration = this.readyConfiguration();
    return Object.freeze({
      connectionId: 'deepseek-api-default',
      modelId: configuration.modelId,
      responsesUrl: configuration.responsesUrl,
      configurationRevision: configuration.configurationRevision,
    });
  }

  credentials() {
    const configuration = this.readyConfiguration();
    return {
      apiKey: configuration.apiKey,
      modelId: configuration.modelId,
      responsesUrl: configuration.responsesUrl,
      configurationRevision: configuration.configurationRevision,
    };
  }

  clear() {
    this.configuration = null;
  }

  private readyConfiguration() {
    const configuration = this.configuration;
    if (!configuration?.verified) {
      throw Object.assign(
        new Error(
          configuration?.connectionMessage || 'Configure the DeepSeek API extension before using Give me ideas',
        ),
        { code: 'CONNECTION_UNAVAILABLE' as const, retryable: false },
      );
    }
    return configuration;
  }
}
