export const CODEX_APP_SERVER_EXTENSION_ID = 'com.aiy.codex-app-server';
export const CODEX_ASSISTANT_DEFAULT_MODEL_KEY = 'gpt-5.6-luna';
export const CODEX_ASSISTANT_DEFAULT_REASONING_EFFORT = 'low' as const;
export const CODEX_IMAGE_MODEL_ID = 'gpt-image-2';
// Keep the historical key on the CLI option: existing drafts and the runs
// created by the pinned-image workaround already use this value.
export const CODEX_CLI_IMAGE_MODEL_KEY = CODEX_IMAGE_MODEL_ID;
export const CODEX_APP_SERVER_IMAGE_MODEL_KEY = 'codex-app-server/gpt-image-2';
export const CODEX_APP_SERVER_PROVIDER_KEY = 'codex-app-server';
export const CODEX_CLI_PROVIDER_KEY = 'codex-cli';
export const CODEX_IMAGE_DISCOVERY_EXTENSION_ID = 'com.aiy.codex-image-discovery';
export const OPENAI_IMAGE_API_EXTENSION_ID = 'com.aiy.openai-image-api';
export const OPENAI_IMAGE_MODEL_KEY = 'openai/gpt-image-2';
export const OPENAI_IMAGE_PROVIDER_KEY = 'openai';
export const DEEPSEEK_API_EXTENSION_ID = 'com.aiy.deepseek-api';
export const ENGLISH_LANGUAGE_EXTENSION_ID = 'com.aiy.language.en';
export const GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID = 'com.aiy.google-gemini-image-api';
export const ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID = 'com.aiy.alibaba-model-studio-image-api';
export const VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID = 'com.aiy.volcengine-ark-image-api';

export const EXTERNAL_IMAGE_API_EXTENSION_IDS = [
  GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
  ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
  VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
] as const;

const GENERATION_PROVIDER_EXTENSION_IDS: Readonly<Record<string, string>> = {
  [CODEX_APP_SERVER_PROVIDER_KEY]: CODEX_APP_SERVER_EXTENSION_ID,
  [CODEX_CLI_PROVIDER_KEY]: CODEX_APP_SERVER_EXTENSION_ID,
  [OPENAI_IMAGE_PROVIDER_KEY]: OPENAI_IMAGE_API_EXTENSION_ID,
  google: GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
  'alibaba-cloud': ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
  volcengine: VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
};

export function generationProviderExtensionId(providerKey: string) {
  return GENERATION_PROVIDER_EXTENSION_IDS[providerKey] ?? null;
}

export type ExternalImageApiExtensionId = (typeof EXTERNAL_IMAGE_API_EXTENSION_IDS)[number];
