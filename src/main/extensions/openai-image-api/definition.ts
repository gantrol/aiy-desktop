import { CODEX_IMAGE_MODEL_ID, OPENAI_IMAGE_PROVIDER_KEY } from '@/shared/extension-ids';

export const OPENAI_IMAGE_PROVIDER = Object.freeze({
  providerKey: OPENAI_IMAGE_PROVIDER_KEY,
  modelId: CODEX_IMAGE_MODEL_ID,
  origin: 'https://api.openai.com',
  baseUrl: 'https://api.openai.com/v1',
  modelUrl: `https://api.openai.com/v1/models/${CODEX_IMAGE_MODEL_ID}`,
});
