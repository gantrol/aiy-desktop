import {
  ALIBABA_IMAGE_PROVIDER_ID,
  CODEX_APP_SERVER_PROVIDER_KEY,
  CODEX_CLI_PROVIDER_KEY,
  CODEX_PROVIDER_ID,
  GOOGLE_IMAGE_PROVIDER_ID,
  OPENAI_IMAGE_PROVIDER_KEY,
  VOLCENGINE_IMAGE_PROVIDER_ID,
} from '@/shared/extension-ids';

export type ProvenanceModelGroup = 'OPENAI' | 'GOOGLE' | 'OTHER';
export type ProvenanceSourceGroup = 'PRODUCT' | 'OFFICIAL_API' | 'GATEWAY' | 'LOCAL';
export type ProvenanceSourceSurface = 'APP' | 'WEB' | 'CLI' | 'API' | 'LOCAL';

export interface ProvenanceModelFamilyDefinition {
  /** Stable semantic identity. It is not an executable route or provider model ID. */
  id: string;
  name: string;
  ownerId: string;
  group: ProvenanceModelGroup;
  aliases: readonly string[];
}

export interface ProvenanceSourceServiceDefinition {
  /** Stable product/service identity. It is independent from credentials and adapters. */
  id: string;
  name: string;
  organizationId: string;
  group: ProvenanceSourceGroup;
  surfaces: readonly ProvenanceSourceSurface[];
  aliases: readonly string[];
  /** Omitted when the service is a gateway or otherwise not tied to a closed model set. */
  modelFamilyIds?: readonly string[];
}

export const PROVENANCE_MODEL_FAMILIES = [
  {
    id: 'openai/gpt-image-2',
    name: 'GPT Image 2',
    ownerId: 'openai',
    group: 'OPENAI',
    aliases: ['gpt-image-2', 'GPT Image 2 · API'],
  },
  {
    id: 'openai/gpt-image-1.5',
    name: 'GPT Image 1.5',
    ownerId: 'openai',
    group: 'OPENAI',
    aliases: ['gpt-image-1.5'],
  },
  {
    id: 'openai/gpt-image-1',
    name: 'GPT Image 1',
    ownerId: 'openai',
    group: 'OPENAI',
    aliases: ['gpt-image-1'],
  },
  {
    id: 'openai/dall-e-3',
    name: 'DALL·E 3',
    ownerId: 'openai',
    group: 'OPENAI',
    aliases: ['DALL-E 3', 'dall-e-3'],
  },
  {
    id: 'google/gemini-3.1-flash-image',
    name: 'Nano Banana 2',
    ownerId: 'google',
    group: 'GOOGLE',
    aliases: ['gemini-3.1-flash-image', 'Nano Banana 2 · Gemini API'],
  },
  {
    id: 'google/nano-banana-2-lite',
    name: 'Nano Banana 2 Lite',
    ownerId: 'google',
    group: 'GOOGLE',
    aliases: [],
  },
  {
    id: 'google/nano-banana-pro',
    name: 'Nano Banana Pro',
    ownerId: 'google',
    group: 'GOOGLE',
    aliases: [],
  },
  {
    id: 'google/nano-banana',
    name: 'Nano Banana',
    ownerId: 'google',
    group: 'GOOGLE',
    aliases: [],
  },
  {
    id: 'midjourney/midjourney',
    name: 'Midjourney',
    ownerId: 'midjourney',
    group: 'OTHER',
    aliases: [],
  },
  {
    id: 'midjourney/niji',
    name: 'Niji',
    ownerId: 'midjourney',
    group: 'OTHER',
    aliases: [],
  },
  {
    id: 'black-forest-labs/flux-2',
    name: 'FLUX.2',
    ownerId: 'black-forest-labs',
    group: 'OTHER',
    aliases: ['FLUX 2'],
  },
  {
    id: 'black-forest-labs/flux-1',
    name: 'FLUX.1',
    ownerId: 'black-forest-labs',
    group: 'OTHER',
    aliases: ['FLUX 1'],
  },
  {
    id: 'stability-ai/stable-diffusion-3.5',
    name: 'Stable Diffusion 3.5',
    ownerId: 'stability-ai',
    group: 'OTHER',
    aliases: ['SD 3.5'],
  },
  {
    id: 'stability-ai/stable-diffusion-xl',
    name: 'Stable Diffusion XL',
    ownerId: 'stability-ai',
    group: 'OTHER',
    aliases: ['SDXL'],
  },
  {
    id: 'adobe/firefly-image',
    name: 'Adobe Firefly Image',
    ownerId: 'adobe',
    group: 'OTHER',
    aliases: ['Adobe Firefly'],
  },
  {
    id: 'ideogram/ideogram',
    name: 'Ideogram',
    ownerId: 'ideogram',
    group: 'OTHER',
    aliases: [],
  },
  {
    id: 'recraft/recraft',
    name: 'Recraft',
    ownerId: 'recraft',
    group: 'OTHER',
    aliases: [],
  },
  {
    id: 'krea/krea-2',
    name: 'Krea 2',
    ownerId: 'krea',
    group: 'OTHER',
    aliases: [],
  },
  {
    id: 'bytedance/doubao-seedream-5-0-260128',
    name: 'Seedream 5.0',
    ownerId: 'bytedance',
    group: 'OTHER',
    aliases: ['Seedream', 'doubao-seedream-5-0-260128'],
  },
  {
    id: 'alibaba/qwen-image-3.0-pro',
    name: 'Qwen Image 3.0 Pro',
    ownerId: 'alibaba',
    group: 'OTHER',
    aliases: ['Qwen Image', 'qwen-image-3.0-pro'],
  },
  {
    id: 'tencent/hunyuan-image',
    name: 'Hunyuan Image',
    ownerId: 'tencent',
    group: 'OTHER',
    aliases: [],
  },
  {
    id: 'kuaishou/kling-image',
    name: 'Kling Image',
    ownerId: 'kuaishou',
    group: 'OTHER',
    aliases: [],
  },
  {
    id: 'kuaishou/kolors',
    name: 'Kolors',
    ownerId: 'kuaishou',
    group: 'OTHER',
    aliases: [],
  },
  {
    id: 'baidu/ernie-vilg',
    name: 'ERNIE-ViLG',
    ownerId: 'baidu',
    group: 'OTHER',
    aliases: [],
  },
  {
    id: 'tongyi-mai/z-image',
    name: 'Z-Image',
    ownerId: 'tongyi-mai',
    group: 'OTHER',
    aliases: [],
  },
] as const satisfies readonly ProvenanceModelFamilyDefinition[];

const openAiModelFamilyIds = [
  'openai/gpt-image-2',
  'openai/gpt-image-1.5',
  'openai/gpt-image-1',
  'openai/dall-e-3',
] as const;
const googleModelFamilyIds = [
  'google/gemini-3.1-flash-image',
  'google/nano-banana-2-lite',
  'google/nano-banana-pro',
  'google/nano-banana',
] as const;

export const PROVENANCE_SOURCE_SERVICES = [
  {
    id: 'openai/chatgpt',
    name: 'ChatGPT App',
    organizationId: 'openai',
    group: 'PRODUCT',
    surfaces: ['APP'],
    aliases: ['ChatGPT'],
    modelFamilyIds: openAiModelFamilyIds,
  },
  {
    id: 'openai/codex',
    name: 'Codex',
    organizationId: 'openai',
    group: 'PRODUCT',
    surfaces: ['APP', 'CLI'],
    aliases: ['Codex App', 'Codex App Server', 'Codex CLI', 'Codex ImageGen'],
    modelFamilyIds: ['openai/gpt-image-2'],
  },
  {
    id: 'google/gemini',
    name: 'Google Gemini Web',
    organizationId: 'google',
    group: 'PRODUCT',
    surfaces: ['WEB'],
    aliases: ['Gemini', 'Gemini App'],
    modelFamilyIds: googleModelFamilyIds,
  },
  {
    id: 'bytedance/doubao',
    name: 'Doubao',
    organizationId: 'bytedance',
    group: 'PRODUCT',
    surfaces: ['APP', 'WEB'],
    aliases: ['豆包'],
    modelFamilyIds: ['bytedance/doubao-seedream-5-0-260128'],
  },
  {
    id: 'openai/images-api',
    name: 'OpenAI Images API',
    organizationId: 'openai',
    group: 'OFFICIAL_API',
    surfaces: ['API'],
    aliases: ['OpenAI API', 'GPT Image 2 · API', OPENAI_IMAGE_PROVIDER_KEY],
    modelFamilyIds: openAiModelFamilyIds,
  },
  {
    id: 'google/gemini-api',
    name: 'Google Gemini API',
    organizationId: 'google',
    group: 'OFFICIAL_API',
    surfaces: ['API'],
    aliases: ['Gemini API', GOOGLE_IMAGE_PROVIDER_ID],
    modelFamilyIds: googleModelFamilyIds,
  },
  {
    id: 'alibaba/model-studio',
    name: 'Alibaba Model Studio',
    organizationId: 'alibaba',
    group: 'OFFICIAL_API',
    surfaces: ['API'],
    aliases: [ALIBABA_IMAGE_PROVIDER_ID],
    modelFamilyIds: ['alibaba/qwen-image-3.0-pro'],
  },
  {
    id: 'bytedance/volcengine-ark',
    name: 'Volcengine Ark',
    organizationId: 'bytedance',
    group: 'OFFICIAL_API',
    surfaces: ['API'],
    aliases: [VOLCENGINE_IMAGE_PROVIDER_ID],
    modelFamilyIds: ['bytedance/doubao-seedream-5-0-260128'],
  },
  {
    id: 'openrouter/openrouter',
    name: 'OpenRouter',
    organizationId: 'openrouter',
    group: 'GATEWAY',
    surfaces: ['API'],
    aliases: [],
  },
  {
    id: 'local/local-deployment',
    name: 'Local deployment',
    organizationId: 'local',
    group: 'LOCAL',
    surfaces: ['LOCAL'],
    aliases: ['Local', '本地部署'],
  },
] as const satisfies readonly ProvenanceSourceServiceDefinition[];

function normalized(value: string) {
  return value.trim().toLocaleLowerCase();
}

const deprecatedGenericSourceNames = new Set(['official api', '官方 api']);

export function isDeprecatedGenericProvenanceSourceName(value: string) {
  return deprecatedGenericSourceNames.has(normalized(value));
}

export function findProvenanceModelFamily(value: string): ProvenanceModelFamilyDefinition | undefined {
  const key = normalized(value);
  if (!key) return undefined;
  return PROVENANCE_MODEL_FAMILIES.find(
    (model) =>
      normalized(model.id) === key ||
      normalized(model.name) === key ||
      model.aliases.some((alias) => normalized(alias) === key),
  );
}

export function findProvenanceSourceService(value: string): ProvenanceSourceServiceDefinition | undefined {
  const key = normalized(value);
  if (!key) return undefined;
  return PROVENANCE_SOURCE_SERVICES.find(
    (source) =>
      normalized(source.id) === key ||
      normalized(source.name) === key ||
      source.aliases.some((alias) => normalized(alias) === key),
  );
}

const sourceServiceIdByProviderId: Readonly<Record<string, string>> = {
  [CODEX_PROVIDER_ID]: 'openai/codex',
  [CODEX_APP_SERVER_PROVIDER_KEY]: 'openai/codex',
  [CODEX_CLI_PROVIDER_KEY]: 'openai/codex',
  [OPENAI_IMAGE_PROVIDER_KEY]: 'openai/images-api',
  [GOOGLE_IMAGE_PROVIDER_ID]: 'google/gemini-api',
  [ALIBABA_IMAGE_PROVIDER_ID]: 'alibaba/model-studio',
  [VOLCENGINE_IMAGE_PROVIDER_ID]: 'bytedance/volcengine-ark',
};

export function provenanceSourceServiceIdForProvider(providerId: string): string | undefined {
  return sourceServiceIdByProviderId[normalized(providerId)];
}
