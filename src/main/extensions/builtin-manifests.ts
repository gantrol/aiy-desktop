import type { ExtensionManifestDto } from '@/shared/contracts';
import { CODEX_CONTENT_APPLICATION_ID } from '@/shared/contracts/content-applications';
import {
  CODEX_LOCAL_METRIC_PROVIDER_ID,
  CODEX_QUOTA_METRIC_PROVIDER_ID,
  OPENAI_COSTS_METRIC_PROVIDER_ID,
} from '@/shared/extension-metrics';
import { EXTENSION_HOST_ENGINE_KEY, EXTENSION_HOST_VERSION } from '@/shared/product';
import { DEEPSEEK_PROVIDER } from '@/main/assistant-models/deepseek-provider';
import {
  DEEPSEEK_VISION_ENDPOINT_PERMISSION,
  DEEPSEEK_VISION_REFERENCE_PERMISSION,
} from '@/main/extensions/deepseek-api/vision-endpoint';
import { OPENAI_IMAGE_PROVIDER } from '@/main/extensions/openai-image-api/definition';
import {
  ALIBABA_IMAGE_PROVIDER_ID,
  ALIBABA_MODEL_STUDIO_IMAGE_API_EXTENSION_ID,
  ANTIGRAVITY_CLI_EXTENSION_ID,
  ANTIGRAVITY_CLI_PROVIDER_KEY,
  CODEX_APP_SERVER_EXTENSION_ID,
  CODEX_PROVIDER_ID,
  CPA_IMAGE_API_EXTENSION_ID,
  CPA_IMAGE_PROVIDER_KEY,
  DEEPSEEK_API_EXTENSION_ID,
  ENGLISH_LANGUAGE_EXTENSION_ID,
  GOOGLE_IMAGE_PROVIDER_ID,
  GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID,
  GOOGLE_GEMINI_ASSISTANT_PROVIDER_KEY,
  OPENAI_IMAGE_API_EXTENSION_ID,
  OPENAI_IMAGE_PROVIDER_KEY,
  TRANSITION_SHOWCASE_EXTENSION_ID,
  VOLCENGINE_IMAGE_PROVIDER_ID,
  VOLCENGINE_ARK_IMAGE_API_EXTENSION_ID,
} from '@/shared/extension-ids';
import { EXTENSION_PERMISSION, EXTENSION_PERMISSION_TEMPLATE } from '@/shared/extension-permissions';
import {
  BYTEPLUS_AP_ENDPOINT_PERMISSION,
  BYTEPLUS_EU_ENDPOINT_PERMISSION,
  externalImageApiConfiguration,
} from '@/main/extensions/external-image-api/endpoints';
import {
  CODEX_HISTORY_SEARCH_CONTRIBUTIONS,
  CODEX_HISTORY_SEARCH_PERMISSIONS,
  CODEX_IMAGE_DISCOVERY_CONTRIBUTIONS,
  CODEX_IMAGE_DISCOVERY_PERMISSIONS,
  CODEX_USAGE_INVESTIGATOR_CONTRIBUTIONS,
  CODEX_USAGE_INVESTIGATOR_OPTIONAL_PERMISSIONS,
  CODEX_USAGE_INVESTIGATOR_PERMISSIONS,
  CODEX_VISUALIZATION_DISCOVERY_CONTRIBUTIONS,
  CODEX_VISUALIZATION_DISCOVERY_PERMISSIONS,
} from '@/main/extensions/host-runtime-contracts';

export const CODEX_APP_SERVER_PERMISSIONS = [
  EXTENSION_PERMISSION.integrationConnectCodexAppServer,
  EXTENSION_PERMISSION.codexManageExtensionThreads,
  EXTENSION_PERMISSION.libraryReadSelectedReferences,
] as const;

export const ANTIGRAVITY_CLI_PERMISSIONS = [
  EXTENSION_PERMISSION.processExecuteAntigravityCli,
  EXTENSION_PERMISSION.libraryReadSelectedReferences,
] as const;

export const OPENAI_IMAGE_API_PERMISSIONS = [
  `network:${OPENAI_IMAGE_PROVIDER.origin}`,
  EXTENSION_PERMISSION.credentialsUseOpenAiApiKey,
  EXTENSION_PERMISSION.libraryReadSelectedReferences,
] as const;

export const DEEPSEEK_API_PERMISSIONS = [
  `network:${DEEPSEEK_PROVIDER.origin}`,
  EXTENSION_PERMISSION.credentialsUseDeepSeekApiKey,
] as const;

const GOOGLE_GEMINI_IMAGE_API_PERMISSIONS = [
  'network:https://generativelanguage.googleapis.com',
  EXTENSION_PERMISSION.credentialsUseGoogleGeminiApiKey,
  EXTENSION_PERMISSION.libraryReadSelectedReferences,
] as const;

const ALIBABA_MODEL_STUDIO_IMAGE_API_PERMISSIONS = [
  EXTENSION_PERMISSION.credentialsUseAlibabaModelStudioApiKey,
  EXTENSION_PERMISSION.libraryReadSelectedReferences,
] as const;

const VOLCENGINE_ARK_IMAGE_API_PERMISSIONS = [
  'network:https://ark.cn-beijing.volces.com',
  EXTENSION_PERMISSION.credentialsUseVolcengineArkApiKey,
  EXTENSION_PERMISSION.libraryReadSelectedReferences,
] as const;
const VOLCENGINE_ARK_IMAGE_API_OPTIONAL_PERMISSIONS = [
  BYTEPLUS_AP_ENDPOINT_PERMISSION,
  BYTEPLUS_EU_ENDPOINT_PERMISSION,
  EXTENSION_PERMISSION_TEMPLATE.userConfiguredHttpsEndpoint,
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
    version: '0.5.4',
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
    id: ANTIGRAVITY_CLI_EXTENSION_ID,
    version: '0.1.1',
    displayName: 'Google Antigravity CLI',
    description: 'Use a local Antigravity sign-in for agent assistance and preview image generation.',
    engines: BUILTIN_EXTENSION_ENGINES,
    contributes: {
      workflows: ['assistant.promptAssist', 'assistant.directionExploration'],
      tools: ['antigravity.image.generate', 'antigravity.image.refine'],
      modelProviders: [ANTIGRAVITY_CLI_PROVIDER_KEY],
    },
    permissions: [...ANTIGRAVITY_CLI_PERMISSIONS],
    optionalPermissions: [],
    i18n: {
      defaultLocale: 'en',
      locales: {
        en: {
          displayName: 'Google Antigravity CLI',
          description: 'Use a local Antigravity sign-in for agent assistance and preview image generation.',
        },
        zh: {
          displayName: 'Google Antigravity CLI',
          description: '使用本机 Antigravity 登录额度进行 Agent 帮写和预览级图像生成。',
        },
      },
    },
  },
  {
    manifestVersion: 1,
    kind: 'CAPABILITY',
    id: CODEX_APP_SERVER_EXTENSION_ID,
    version: '0.3.6',
    displayName: 'Did Codex Work Hard Today?',
    description: 'Connect Codex and manage local task history, usage, images, and visualizations in one workspace.',
    engines: BUILTIN_EXTENSION_ENGINES,
    contributes: {
      commands: [
        'codex.refreshConnection',
        ...(CODEX_HISTORY_SEARCH_CONTRIBUTIONS.commands ?? []),
        ...(CODEX_IMAGE_DISCOVERY_CONTRIBUTIONS.commands ?? []),
        ...(CODEX_USAGE_INVESTIGATOR_CONTRIBUTIONS.commands ?? []),
        ...(CODEX_VISUALIZATION_DISCOVERY_CONTRIBUTIONS.commands ?? []),
      ],
      workflows: [
        'codex.promptAssist',
        'codex.directionExploration',
        'codex.targetedImageRefinement',
        ...(CODEX_HISTORY_SEARCH_CONTRIBUTIONS.workflows ?? []),
        ...(CODEX_IMAGE_DISCOVERY_CONTRIBUTIONS.workflows ?? []),
        ...(CODEX_USAGE_INVESTIGATOR_CONTRIBUTIONS.workflows ?? []),
        ...(CODEX_VISUALIZATION_DISCOVERY_CONTRIBUTIONS.workflows ?? []),
      ],
      tools: ['codex.image.generate', 'codex.image.refine'],
      searchProviders: [
        ...(CODEX_HISTORY_SEARCH_CONTRIBUTIONS.searchProviders ?? []),
        ...(CODEX_IMAGE_DISCOVERY_CONTRIBUTIONS.searchProviders ?? []),
        ...(CODEX_VISUALIZATION_DISCOVERY_CONTRIBUTIONS.searchProviders ?? []),
      ],
      modelProviders: [CODEX_PROVIDER_ID],
      contentApplications: [CODEX_CONTENT_APPLICATION_ID],
      metricProviders: [CODEX_LOCAL_METRIC_PROVIDER_ID, CODEX_QUOTA_METRIC_PROVIDER_ID],
    },
    permissions: [
      ...new Set([
        ...CODEX_APP_SERVER_PERMISSIONS,
        ...CODEX_HISTORY_SEARCH_PERMISSIONS,
        ...CODEX_IMAGE_DISCOVERY_PERMISSIONS,
        ...CODEX_USAGE_INVESTIGATOR_PERMISSIONS,
        ...CODEX_VISUALIZATION_DISCOVERY_PERMISSIONS,
      ]),
    ],
    optionalPermissions: [
      ...CODEX_USAGE_INVESTIGATOR_OPTIONAL_PERMISSIONS,
      EXTENSION_PERMISSION.libraryReadSelectedContent,
    ],
    i18n: {
      defaultLocale: 'en',
      locales: {
        en: {
          displayName: 'Did Codex Work Hard Today?',
          description:
            'Connect Codex and manage local task history, usage, images, and visualizations in one workspace.',
        },
        zh: {
          displayName: 'Codex今天努力了吗？',
          description: '连接 Codex，并在一个工作台管理本地聊天记录、用量、图片和可视化。',
        },
      },
    },
  },
  {
    manifestVersion: 1,
    kind: 'CAPABILITY',
    id: OPENAI_IMAGE_API_EXTENSION_ID,
    version: '0.3.3',
    displayName: 'OpenAI Image API',
    description: 'Call GPT Image models with independent OpenAI API credentials.',
    engines: BUILTIN_EXTENSION_ENGINES,
    contributes: {
      modelProviders: [OPENAI_IMAGE_PROVIDER_KEY],
      metricProviders: [OPENAI_COSTS_METRIC_PROVIDER_ID],
    },
    permissions: [...OPENAI_IMAGE_API_PERMISSIONS],
    optionalPermissions: [
      EXTENSION_PERMISSION.accountReadOpenAiCosts,
      EXTENSION_PERMISSION.credentialsUseOpenAiAdminKey,
    ],
    i18n: {
      defaultLocale: 'en',
      locales: {
        en: {
          displayName: 'OpenAI Image API',
          description: 'Call GPT Image models with independent OpenAI API credentials.',
        },
        zh: {
          displayName: 'OpenAI 图像 API',
          description: '使用独立 OpenAI API 凭据调用 GPT Image 模型。',
        },
      },
    },
  },
  {
    manifestVersion: 1,
    kind: 'CAPABILITY',
    id: CPA_IMAGE_API_EXTENSION_ID,
    version: '0.1.0',
    displayName: 'Codex backend images · CPA',
    description: 'Generate and edit images through a separately configured CLIProxyAPI service.',
    engines: BUILTIN_EXTENSION_ENGINES,
    contributes: { modelProviders: [CPA_IMAGE_PROVIDER_KEY] },
    permissions: [
      'network:http://127.0.0.1:8317',
      EXTENSION_PERMISSION.credentialsUseCpaImageKey,
      EXTENSION_PERMISSION.libraryReadSelectedReferences,
    ],
    optionalPermissions: [EXTENSION_PERMISSION_TEMPLATE.userConfiguredCpaEndpoint],
    i18n: {
      defaultLocale: 'en',
      locales: {
        en: {
          displayName: 'Codex backend images · CPA',
          description: 'Generate and edit images through a separately configured CLIProxyAPI service.',
        },
        zh: {
          displayName: 'Codex 后台图片 · CPA',
          description: '通过独立配置的 CLIProxyAPI 服务生成和编辑图片。',
        },
      },
    },
  },
  {
    manifestVersion: 1,
    kind: 'CAPABILITY',
    id: DEEPSEEK_API_EXTENSION_ID,
    version: '0.3.2',
    displayName: 'DeepSeek API',
    description: 'Use DeepSeek V4 Flash for prompt writing, web-grounded optimization, and creative directions.',
    engines: BUILTIN_EXTENSION_ENGINES,
    contributes: {
      workflows: ['assistant.promptAssist', 'assistant.webSearchPromptAssist', 'assistant.directionExploration'],
      modelProviders: ['deepseek'],
    },
    permissions: [...DEEPSEEK_API_PERMISSIONS],
    optionalPermissions: [DEEPSEEK_VISION_REFERENCE_PERMISSION, DEEPSEEK_VISION_ENDPOINT_PERMISSION],
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
    version: '0.1.3',
    displayName: 'Google Gemini API',
    description: 'Use an AI Studio API key for Gemini assistant tasks and direct image generation.',
    engines: BUILTIN_EXTENSION_ENGINES,
    contributes: {
      workflows: ['assistant.promptAssist', 'assistant.directionExploration'],
      modelProviders: [GOOGLE_IMAGE_PROVIDER_ID, GOOGLE_GEMINI_ASSISTANT_PROVIDER_KEY],
    },
    permissions: [...GOOGLE_GEMINI_IMAGE_API_PERMISSIONS],
    optionalPermissions: [EXTENSION_PERMISSION_TEMPLATE.userConfiguredHttpsEndpoint],
    configuration: externalImageApiConfiguration(GOOGLE_GEMINI_IMAGE_API_EXTENSION_ID),
    i18n: {
      defaultLocale: 'en',
      locales: {
        en: {
          displayName: 'Google Gemini API',
          description: 'Use an AI Studio API key for Gemini assistant tasks and direct image generation.',
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
          displayName: 'Google Gemini API',
          description: '使用 AI Studio API Key 调用 Gemini 助手，并直连生成和编辑图像。',
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
    version: '0.1.2',
    displayName: 'Alibaba Model Studio Image API',
    description:
      'Not tested with a live API. Generate and edit images with Qwen Image 3.0 Pro through Alibaba Cloud Model Studio.',
    engines: BUILTIN_EXTENSION_ENGINES,
    contributes: { modelProviders: [ALIBABA_IMAGE_PROVIDER_ID] },
    permissions: [...ALIBABA_MODEL_STUDIO_IMAGE_API_PERMISSIONS],
    optionalPermissions: [EXTENSION_PERMISSION_TEMPLATE.userConfiguredHttpsEndpoint],
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
    version: '0.1.2',
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
