import type { ExtensionManifestDto } from '@/shared/contracts';
import { EXTENSION_HOST_ENGINE_KEY, EXTENSION_HOST_VERSION } from '@/shared/product';
import { DEEPSEEK_PROVIDER } from '@/main/assistant-models/deepseek-provider';
import { OPENAI_IMAGE_PROVIDER } from '@/main/extensions/openai-image-api/definition';
import {
  ALIBABA_IMAGE_PROVIDER_ID,
  ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
  CODEX_APP_SERVER_EXTENSION_ID,
  CODEX_PROVIDER_ID,
  DEEPSEEK_API_EXTENSION_ID,
  ENGLISH_LANGUAGE_EXTENSION_ID,
  GOOGLE_IMAGE_PROVIDER_ID,
  GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
  OPENAI_IMAGE_API_EXTENSION_ID,
  OPENAI_IMAGE_PROVIDER_KEY,
  TRANSITION_SHOWCASE_EXTENSION_ID,
  VOLCENGINE_IMAGE_PROVIDER_ID,
  VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
} from '@/shared/extension-ids';
import {
  BYTEPLUS_AP_ENDPOINT_PERMISSION,
  BYTEPLUS_EU_ENDPOINT_PERMISSION,
  USER_CONFIGURED_HTTPS_ENDPOINT_PERMISSION,
  externalImageApiConfiguration,
} from '@/main/extensions/external-image-api/endpoints';

export const CODEX_APP_SERVER_PERMISSIONS = ['codex:app-server', 'codex:threads', 'library.read:references'] as const;

export const OPENAI_IMAGE_API_PERMISSIONS = [
  `network:${OPENAI_IMAGE_PROVIDER.origin}`,
  'secrets:openai-api-key',
  'library.read:references',
] as const;

export const DEEPSEEK_API_PERMISSIONS = [`network:${DEEPSEEK_PROVIDER.origin}`, 'secrets:deepseek-api-key'] as const;

const GOOGLE_GEMINI_IMAGE_API_PERMISSIONS = [
  'network:https://generativelanguage.googleapis.com',
  'secrets:google-gemini-api-key',
  'library.read:references',
] as const;

const ALIBABA_MODEL_STUDIO_IMAGE_API_PERMISSIONS = [
  'network:https://aliyuncs.com',
  'secrets:alibaba-model-studio-api-key',
  'library.read:references',
] as const;

const VOLCENGINE_ARK_IMAGE_API_PERMISSIONS = [
  'network:https://ark.cn-beijing.volces.com',
  'secrets:volcengine-ark-api-key',
  'library.read:references',
] as const;
const VOLCENGINE_ARK_IMAGE_API_OPTIONAL_PERMISSIONS = [
  BYTEPLUS_AP_ENDPOINT_PERMISSION,
  BYTEPLUS_EU_ENDPOINT_PERMISSION,
  USER_CONFIGURED_HTTPS_ENDPOINT_PERMISSION,
] as const;

const BUILTIN_EXTENSION_ENGINES: ExtensionManifestDto['engines'] = {
  [EXTENSION_HOST_ENGINE_KEY]: `^${EXTENSION_HOST_VERSION}`,
};

export const BUILTIN_EXTENSION_MANIFESTS: readonly ExtensionManifestDto[] = [
  {
    manifestVersion: 1,
    kind: 'CAPABILITY',
    category: 'FRONTEND_DESIGN',
    id: TRANSITION_SHOWCASE_EXTENSION_ID,
    version: '0.3.2',
    displayName: 'Transition Showcase',
    description: 'Inspect transition aspect ratios, media states, responsive layouts, and motion behavior.',
    engines: BUILTIN_EXTENSION_ENGINES,
    contributes: {},
    permissions: [],
    optionalPermissions: [],
    i18n: {
      defaultLocale: 'en',
      locales: {
        en: {
          displayName: 'Transition Showcase',
          description: 'Inspect transition aspect ratios, media states, responsive layouts, and motion behavior.',
        },
        zh: {
          displayName: '过场动画展',
          description: '检查过场动画的图片比例、媒体状态、响应式布局和运动表现。',
        },
      },
    },
  },
  {
    manifestVersion: 1,
    kind: 'LANGUAGE',
    id: ENGLISH_LANGUAGE_EXTENSION_ID,
    version: '0.3.2',
    displayName: 'English',
    description: "Provides the app's English interface.",
    engines: BUILTIN_EXTENSION_ENGINES,
    contributes: {},
    permissions: [],
    optionalPermissions: [],
    language: { locale: 'en', htmlLanguage: 'en' },
    i18n: {
      defaultLocale: 'en',
      locales: {
        zh: {
          displayName: '英语',
          description: '提供英语界面。',
        },
        en: {
          displayName: 'English',
          description: "Provides the app's English interface.",
        },
      },
    },
  },
  {
    manifestVersion: 1,
    kind: 'CAPABILITY',
    id: CODEX_APP_SERVER_EXTENSION_ID,
    version: '0.3.1',
    displayName: 'Codex App Server',
    description: 'Codex tasks, creative proposals, and separate App Server and CLI image generation routes.',
    engines: BUILTIN_EXTENSION_ENGINES,
    contributes: {
      commands: ['codex.refreshConnection'],
      workflows: ['codex.promptAssist', 'codex.directionExploration', 'codex.targetedImageRefinement'],
      tools: ['codex.image.generate', 'codex.image.refine'],
      modelProviders: [CODEX_PROVIDER_ID],
    },
    permissions: [...CODEX_APP_SERVER_PERMISSIONS],
    optionalPermissions: [],
    i18n: {
      defaultLocale: 'en',
      locales: {
        en: {
          displayName: 'Codex App Server',
          description: 'Codex tasks, creative proposals, and separate App Server and CLI image generation routes.',
        },
        zh: {
          displayName: 'Codex 应用服务器',
          description: '连接 Codex 任务与创作提案，并提供彼此独立的 App Server、CLI 生图路径和基于评注的定向精修能力。',
        },
      },
    },
  },
  {
    manifestVersion: 1,
    kind: 'CAPABILITY',
    id: OPENAI_IMAGE_API_EXTENSION_ID,
    version: '0.3.1',
    displayName: 'OpenAI Image API',
    description: 'Call GPT Image 2 with independent OpenAI API credentials.',
    engines: BUILTIN_EXTENSION_ENGINES,
    contributes: {
      modelProviders: [OPENAI_IMAGE_PROVIDER_KEY],
    },
    permissions: [...OPENAI_IMAGE_API_PERMISSIONS],
    optionalPermissions: [],
    i18n: {
      defaultLocale: 'en',
      locales: {
        en: {
          displayName: 'OpenAI Image API',
          description: 'Call GPT Image 2 with independent OpenAI API credentials.',
        },
        zh: {
          displayName: 'OpenAI 图像 API',
          description: '使用独立 OpenAI API 凭据调用 GPT Image 2。',
        },
      },
    },
  },
  {
    manifestVersion: 1,
    kind: 'CAPABILITY',
    id: DEEPSEEK_API_EXTENSION_ID,
    version: '0.3.1',
    displayName: 'DeepSeek API',
    description: 'Use DeepSeek V4 Flash for prompt writing, web-grounded optimization, and creative directions.',
    engines: BUILTIN_EXTENSION_ENGINES,
    contributes: {
      workflows: ['assistant.promptAssist', 'assistant.webSearchPromptAssist', 'assistant.directionExploration'],
      modelProviders: ['deepseek'],
    },
    permissions: [...DEEPSEEK_API_PERMISSIONS],
    optionalPermissions: [],
    i18n: {
      defaultLocale: 'en',
      locales: {
        en: {
          displayName: 'DeepSeek API',
          description: 'Use DeepSeek V4 Flash for prompt writing, web-grounded optimization, and creative directions.',
        },
        zh: {
          displayName: 'DeepSeek API',
          description: '使用 DeepSeek V4 Flash 进行 Prompt 帮写、联网优化和创作灵感探索。',
        },
      },
    },
  },
  {
    manifestVersion: 1,
    kind: 'CAPABILITY',
    id: GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
    version: '0.1.1',
    displayName: 'Google Gemini Image API',
    description: 'Not tested with a live API. Generate and edit images with Nano Banana 2 through the Gemini API.',
    engines: BUILTIN_EXTENSION_ENGINES,
    contributes: { modelProviders: [GOOGLE_IMAGE_PROVIDER_ID] },
    permissions: [...GOOGLE_GEMINI_IMAGE_API_PERMISSIONS],
    optionalPermissions: [USER_CONFIGURED_HTTPS_ENDPOINT_PERMISSION],
    configuration: externalImageApiConfiguration(GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID),
    i18n: {
      defaultLocale: 'en',
      locales: {
        en: {
          displayName: 'Google Gemini Image API',
          description:
            'Not tested with a live API. Generate and edit images with Nano Banana 2 through the Gemini API.',
          configuration: {
            title: 'Gemini API connection',
            apiKeyLabel: 'Gemini API Key',
            apiKeyPlaceholder: 'Enter a Gemini API key',
            endpointLabel: 'Service endpoint',
            endpointOptions: {
              'google-global': 'Google global endpoint',
              custom: 'Other (Gemini-compatible)',
            },
            customEndpointLabel: 'Custom request URL',
            customEndpointPlaceholder: 'https://gateway.example.com/v1beta/interactions',
            modelIdLabel: 'Model ID',
            modelIdPlaceholder: 'gemini-3.1-flash-image',
            fields: {},
          },
        },
        zh: {
          displayName: 'Google Gemini 图像 API',
          description: '未实际测试。通过 Gemini API 使用 Nano Banana 2 生成和编辑图像。',
          configuration: {
            title: 'Gemini API 连接',
            apiKeyLabel: 'Gemini API Key',
            apiKeyPlaceholder: '输入 Gemini API Key',
            endpointLabel: '服务端点',
            endpointOptions: {
              'google-global': 'Google 全球端点',
              custom: '其他（兼容 Gemini 协议）',
            },
            customEndpointLabel: '自定义请求地址',
            customEndpointPlaceholder: 'https://gateway.example.com/v1beta/interactions',
            modelIdLabel: '模型 ID',
            modelIdPlaceholder: 'gemini-3.1-flash-image',
            fields: {},
          },
        },
      },
    },
  },
  {
    manifestVersion: 1,
    kind: 'CAPABILITY',
    id: ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
    version: '0.1.1',
    displayName: 'Alibaba Model Studio Image API',
    description:
      'Not tested with a live API. Generate and edit images with Qwen Image 3.0 Pro through Alibaba Cloud Model Studio.',
    engines: BUILTIN_EXTENSION_ENGINES,
    contributes: { modelProviders: [ALIBABA_IMAGE_PROVIDER_ID] },
    permissions: [...ALIBABA_MODEL_STUDIO_IMAGE_API_PERMISSIONS],
    optionalPermissions: [USER_CONFIGURED_HTTPS_ENDPOINT_PERMISSION],
    configuration: externalImageApiConfiguration(ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID),
    i18n: {
      defaultLocale: 'en',
      locales: {
        en: {
          displayName: 'Alibaba Cloud Model Studio Image API',
          description:
            'Not tested with a live API. Generate and edit images with Qwen Image 3.0 Pro through Alibaba Cloud Model Studio.',
          configuration: {
            title: 'Model Studio API connection',
            apiKeyLabel: 'Model Studio API Key',
            apiKeyPlaceholder: 'Enter a Model Studio API key',
            endpointLabel: 'Service region / endpoint',
            endpointOptions: {
              'alibaba-cn-beijing': 'Chinese mainland · Beijing',
              'alibaba-singapore': 'International · Singapore',
              custom: 'Other (Model Studio-compatible)',
            },
            customEndpointLabel: 'Custom request URL',
            customEndpointPlaceholder:
              'https://gateway.example.com/api/v1/services/aigc/multimodal-generation/generation',
            modelIdLabel: 'Model ID',
            modelIdPlaceholder: 'qwen-image-3.0-pro',
            fields: {
              workspaceId: { label: 'Workspace ID', placeholder: 'Enter the Model Studio workspace ID' },
            },
          },
        },
        zh: {
          displayName: '阿里云百炼图像 API',
          description: '未实际测试。通过阿里云百炼使用 Qwen Image 3.0 Pro 生成和编辑图像。',
          configuration: {
            title: '百炼 API 连接',
            apiKeyLabel: '百炼 API Key',
            apiKeyPlaceholder: '输入百炼 API Key',
            endpointLabel: '服务区域 / 端点',
            endpointOptions: {
              'alibaba-cn-beijing': '中国大陆 · 北京',
              'alibaba-singapore': '国际 · 新加坡',
              custom: '其他（兼容百炼协议）',
            },
            customEndpointLabel: '自定义请求地址',
            customEndpointPlaceholder:
              'https://gateway.example.com/api/v1/services/aigc/multimodal-generation/generation',
            modelIdLabel: '模型 ID',
            modelIdPlaceholder: 'qwen-image-3.0-pro',
            fields: {
              workspaceId: { label: 'Workspace ID', placeholder: '输入百炼业务空间 ID' },
            },
          },
        },
      },
    },
  },
  {
    manifestVersion: 1,
    kind: 'CAPABILITY',
    id: VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
    version: '0.1.1',
    displayName: 'Volcengine Ark / BytePlus ModelArk Image API',
    description:
      'Not tested with a live API. Generate Seedream 5.0 images through Volcengine Ark or BytePlus ModelArk regional endpoints.',
    engines: BUILTIN_EXTENSION_ENGINES,
    contributes: { modelProviders: [VOLCENGINE_IMAGE_PROVIDER_ID] },
    permissions: [...VOLCENGINE_ARK_IMAGE_API_PERMISSIONS],
    optionalPermissions: [...VOLCENGINE_ARK_IMAGE_API_OPTIONAL_PERMISSIONS],
    configuration: externalImageApiConfiguration(VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID),
    i18n: {
      defaultLocale: 'en',
      locales: {
        en: {
          displayName: 'Volcengine Ark / BytePlus ModelArk Image API',
          description:
            'Not tested with a live API. Generate Seedream 5.0 images through Volcengine Ark or BytePlus ModelArk regional endpoints.',
          configuration: {
            title: 'Ark / ModelArk API connection',
            apiKeyLabel: 'Ark / ModelArk API Key',
            apiKeyPlaceholder: 'Enter an Ark or ModelArk API key',
            endpointLabel: 'Service region / endpoint',
            endpointOptions: {
              'volcengine-cn-beijing': 'Chinese mainland · Volcengine Beijing',
              'byteplus-ap-southeast-1': 'Asia Pacific · BytePlus ModelArk',
              'byteplus-eu-west-1': 'Europe · BytePlus ModelArk',
              custom: 'Other (Ark-compatible)',
            },
            customEndpointLabel: 'Custom request URL',
            customEndpointPlaceholder: 'https://gateway.example.com/api/v3/images/generations',
            modelIdLabel: 'Model ID',
            modelIdPlaceholder: 'dola-seedream-5-0-pro-260628',
            fields: {},
          },
        },
        zh: {
          displayName: '火山引擎方舟 / BytePlus ModelArk 图像 API',
          description: '未实际测试。通过火山引擎方舟或 BytePlus ModelArk 的地域端点使用 Seedream 5.0。',
          configuration: {
            title: '火山引擎方舟 / ModelArk API 连接',
            apiKeyLabel: '方舟 / ModelArk API Key',
            apiKeyPlaceholder: '输入方舟或 ModelArk API Key',
            endpointLabel: '服务区域 / 端点',
            endpointOptions: {
              'volcengine-cn-beijing': '中国大陆 · 火山引擎方舟（北京）',
              'byteplus-ap-southeast-1': '亚太 · BytePlus ModelArk',
              'byteplus-eu-west-1': '欧洲 · BytePlus ModelArk',
              custom: '其他（兼容方舟协议）',
            },
            customEndpointLabel: '自定义请求地址',
            customEndpointPlaceholder: 'https://gateway.example.com/api/v3/images/generations',
            modelIdLabel: '模型 ID',
            modelIdPlaceholder: 'dola-seedream-5-0-pro-260628',
            fields: {},
          },
        },
      },
    },
  },
] as const;
