export interface DeepSeekApiRuntimeConfiguration {
  apiKey: string;
  modelId: string;
  responsesUrl: string;
  configurationRevision: string;
  verified: boolean;
  connectionMessage: string;
}

export interface DeepSeekApiRuntimeStatus {
  configured: boolean;
  ready: boolean;
  message: string;
}
