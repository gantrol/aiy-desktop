import type { OpenAiImageModeration } from '@/shared/contracts';

export interface OpenAiImageApiRuntimeConfiguration {
  apiKey: string;
  organizationId: string | null;
  projectId: string | null;
  /** Omission selects the product default; persisted configurations always include it. */
  moderation?: OpenAiImageModeration;
  usable: boolean;
  verified: boolean;
  connectionMessage: string;
}

export interface OpenAiImageApiRuntimeStatus {
  configured: boolean;
  usable: boolean;
  verified: boolean;
  message: string;
}
