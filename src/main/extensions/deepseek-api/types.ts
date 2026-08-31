import { DEEPSEEK_API_CONNECTION_ID } from '@/shared/extension-ids';

export interface DeepSeekApiRuntimeConfiguration {
  apiKey: string;
  modelId: string;
  responsesUrl: string;
  visionEndpoint: string;
  visionModelId: string;
  configurationRevision: string;
  verified: boolean;
  connectionMessage: string;
}

export interface DeepSeekApiRuntimeStatus {
  configured: boolean;
  ready: boolean;
  message: string;
}

export interface DeepSeekApiConnectionSnapshot {
  connectionId: typeof DEEPSEEK_API_CONNECTION_ID;
  modelId: string;
  responsesUrl: string;
  visionEndpoint: string;
  visionModelId: string;
  configurationRevision: string;
}
