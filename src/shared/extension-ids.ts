import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';

export const CODEX_APP_SERVER_EXTENSION_ID = 'com.aiy.codex-app-server';
export const CODEX_PROVIDER_ID = 'codex';
export const CODEX_ASSISTANT_DEFAULT_MODEL_KEY = 'gpt-5.6-luna';
export const CODEX_ASSISTANT_DEFAULT_REASONING_EFFORT = 'low' as const;
export const CODEX_IMAGE_MODEL_ID = 'gpt-image-2';
// Keep the historical key on the CLI option: existing drafts and the runs
// created by the pinned-image workaround already use this value.
export const CODEX_CLI_IMAGE_MODEL_KEY = CODEX_IMAGE_MODEL_ID;
export const CODEX_APP_SERVER_IMAGE_MODEL_KEY = 'codex-app-server/gpt-image-2';
export const CODEX_APP_SERVER_PROVIDER_KEY = 'codex-app-server';
export const CODEX_CLI_PROVIDER_KEY = 'codex-cli';
export const CODEX_APP_SERVER_CONNECTION_ID = `${CODEX_APP_SERVER_EXTENSION_ID}:app-server`;
export const CODEX_CLI_CONNECTION_ID = `${CODEX_APP_SERVER_EXTENSION_ID}:cli`;
export const CODEX_IMAGE_DISCOVERY_EXTENSION_ID = 'com.aiy.codex-image-discovery';
export const CODEX_HISTORY_SEARCH_EXTENSION_ID = 'com.aiy.codex-history-search';
export const CODEX_VISUALIZATION_DISCOVERY_EXTENSION_ID = 'com.aiy.codex-visualization-discovery';
export const CODEX_VISUALIZATION_THREAD_CONTENT_PERMISSION = EXTENSION_PERMISSION.filesystemReadCodexThreadContent;
export const CODEX_USAGE_INVESTIGATOR_EXTENSION_ID = 'com.aiy.codex-usage-investigator';
export const WEIBO_CHANNEL_EXTENSION_ID = 'com.aiy.channel.weibo';
export const ANTIGRAVITY_CLI_EXTENSION_ID = 'com.aiy.antigravity-cli';
export const ANTIGRAVITY_CLI_PROVIDER_KEY = 'antigravity-cli';
export const ANTIGRAVITY_CLI_CONNECTION_ID = `${ANTIGRAVITY_CLI_EXTENSION_ID}:cli`;
export const ANTIGRAVITY_CLI_DEFAULT_MODEL_KEY = 'antigravity-default';
export const ANTIGRAVITY_CLI_IMAGE_MODEL_ID = 'antigravity-agent-image';
export const ANTIGRAVITY_CLI_IMAGE_MODEL_KEY = `${ANTIGRAVITY_CLI_PROVIDER_KEY}/${ANTIGRAVITY_CLI_IMAGE_MODEL_ID}`;
export const TRANSITION_SHOWCASE_EXTENSION_ID = 'com.aiy.transition-showcase';
export const FEATURE_DEMO_EXTENSION_ID = 'com.aiy.feature-demo';
export const OPENAI_IMAGE_API_EXTENSION_ID = 'com.aiy.openai-image-api';
export const OPENAI_IMAGE_MODEL_KEY = 'openai/gpt-image-2';
export const OPENAI_IMAGE_PROVIDER_KEY = 'openai';
export const OPENAI_IMAGE_CONNECTION_ID = `${OPENAI_IMAGE_API_EXTENSION_ID}:default`;
export const DEEPSEEK_API_EXTENSION_ID = 'com.aiy.deepseek-api';
/** Historical runtime identity retained by persisted assistant runs. */
export const DEEPSEEK_API_CONNECTION_ID = 'deepseek-api-default';
export const ENGLISH_LANGUAGE_EXTENSION_ID = 'com.aiy.language.en';
export const GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID = 'com.aiy.google-gemini-image-api';
/** Legacy ID retained because existing installations and encrypted connection files use it. */
export const GOOGLE_GEMINI_API_EXTENSION_ID = GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID;
export const GOOGLE_GEMINI_ASSISTANT_PROVIDER_KEY = 'google-gemini';
export const GOOGLE_GEMINI_ASSISTANT_MODEL_KEY = 'gemini-3.6-flash';
export const ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID = 'com.aiy.alibaba-model-studio-image-api';
export const VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID = 'com.aiy.volcengine-ark-image-api';

export const GOOGLE_IMAGE_PROVIDER_ID = 'google';
export const ALIBABA_IMAGE_PROVIDER_ID = 'alibaba-cloud';
export const VOLCENGINE_IMAGE_PROVIDER_ID = 'volcengine';

export const EXTERNAL_IMAGE_API_EXTENSION_IDS = [
  GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
  ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
  VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
] as const;

const GENERATION_PROVIDER_EXTENSION_IDS: Readonly<Record<string, string>> = {
  [CODEX_PROVIDER_ID]: CODEX_APP_SERVER_EXTENSION_ID,
  [CODEX_APP_SERVER_PROVIDER_KEY]: CODEX_APP_SERVER_EXTENSION_ID,
  [CODEX_CLI_PROVIDER_KEY]: CODEX_APP_SERVER_EXTENSION_ID,
  [ANTIGRAVITY_CLI_PROVIDER_KEY]: ANTIGRAVITY_CLI_EXTENSION_ID,
  [OPENAI_IMAGE_PROVIDER_KEY]: OPENAI_IMAGE_API_EXTENSION_ID,
  [GOOGLE_IMAGE_PROVIDER_ID]: GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
  [ALIBABA_IMAGE_PROVIDER_ID]: ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
  [VOLCENGINE_IMAGE_PROVIDER_ID]: VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
};

export function generationProviderExtensionId(providerKey: string) {
  return GENERATION_PROVIDER_EXTENSION_IDS[providerKey] ?? null;
}

const EXTERNAL_IMAGE_PROVIDER_IDS: Readonly<Record<ExternalImageApiExtensionId, string>> = {
  [GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID]: GOOGLE_IMAGE_PROVIDER_ID,
  [ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID]: ALIBABA_IMAGE_PROVIDER_ID,
  [VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID]: VOLCENGINE_IMAGE_PROVIDER_ID,
};

export function externalImageProviderId(extensionId: ExternalImageApiExtensionId) {
  return EXTERNAL_IMAGE_PROVIDER_IDS[extensionId];
}

export function externalImageConnectionId(extensionId: ExternalImageApiExtensionId) {
  return `${extensionId}:default`;
}

export type ExternalImageApiExtensionId = (typeof EXTERNAL_IMAGE_API_EXTENSION_IDS)[number];
