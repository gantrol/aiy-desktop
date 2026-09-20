import {
  OPENAI_IMAGE_FLARE_MODEL_KEY,
  OPENAI_IMAGE_MODEL_KEY,
  OPENAI_IMAGE_PROVIDER_KEY,
  OPENAI_IMAGE_SUNBURST_MODEL_KEY,
} from '@/shared/extension-ids';

export const OPENAI_IMAGE_MODELS = [
  {
    key: OPENAI_IMAGE_MODEL_KEY,
    modelId: 'gpt-image-2',
    name: 'GPT Image 2',
    supportedQualities: ['low', 'medium', 'high'],
  },
  {
    key: OPENAI_IMAGE_SUNBURST_MODEL_KEY,
    modelId: 'gpt-image-2.5-sunburst',
    name: 'GPT Image 2.5 Sunburst',
    supportedQualities: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    key: OPENAI_IMAGE_FLARE_MODEL_KEY,
    modelId: 'gpt-image-2.5-flare',
    name: 'GPT Image 2.5 Flare',
    supportedQualities: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
] as const;

export const OPENAI_IMAGE_PROVIDER = Object.freeze({
  providerKey: OPENAI_IMAGE_PROVIDER_KEY,
  modelId: OPENAI_IMAGE_MODELS[0].modelId,
  origin: 'https://api.openai.com',
  baseUrl: 'https://api.openai.com/v1',
  modelUrl: `https://api.openai.com/v1/models/${OPENAI_IMAGE_MODELS[0].modelId}`,
});
