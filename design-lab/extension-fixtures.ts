import type { ExtensionDto } from '@/shared/contracts';
import { EXTENSION_PERMISSION as P, EXTENSION_PERMISSION_TEMPLATE as T } from '@/shared/extension-permissions';

/** In-memory examples, never registered as installed packages. */
export function extensionExamples(): ExtensionDto[] {
  const definitions = [
    {
      id: 'example.local-drafts',
      title: 'Local draft receiver',
      zh: '本地草稿接收器',
      source: 'LOCAL' as const,
      permissions: ['network:http://127.0.0.1:47839', 'credentials.use:example-local-draft-token'],
      optional: [],
      granted: true,
    },
    {
      id: 'example.reference-tool',
      title: 'Selected-reference tool',
      zh: '选定材料工具',
      source: 'BUILT_IN' as const,
      permissions: [P.libraryReadSelectedContent, P.libraryReadSelectedReferences],
      optional: [T.userConfiguredHttpsEndpoint],
      granted: true,
    },
    {
      id: 'example.agent',
      title: 'External agent',
      zh: '外部 Agent',
      source: 'BUILT_IN' as const,
      permissions: [P.integrationConnectCodexAppServer, P.filesystemReadCodexThreadContent],
      optional: [],
      granted: false,
    },
  ];
  return definitions.map((definition) => ({
    manifest: {
      manifestVersion: 1,
      kind: 'CAPABILITY',
      id: definition.id,
      version: '1.0.0',
      engines: { aiy: '^0.3.9' },
      displayName: definition.title,
      description: 'Example only',
      contributes: { commands: ['example.inspect'] },
      permissions: definition.permissions,
      optionalPermissions: definition.optional,
      i18n: {
        defaultLocale: 'en',
        locales: {
          en: { displayName: definition.title, description: 'Example only; no real task is executed.' },
          zh: { displayName: definition.zh, description: '仅为交互示例，不会执行真实任务。' },
        },
      },
    },
    source: definition.source,
    enabled: true,
    compatible: true,
    effective: definition.granted,
    connectionState: definition.granted ? 'READY' : 'PERMISSION_REQUIRED',
    connectionMessage: '',
    permissions: [
      ...definition.permissions.map((key) => ({
        key,
        required: true,
        granted: definition.granted,
        runtimeScoped: false,
      })),
      ...(definition.optional.length
        ? [{ key: 'network:https://example.invalid', required: false, granted: true, runtimeScoped: true }]
        : []),
    ],
    installedAt: '2026-09-14T00:00:00.000Z',
    updatedAt: '2026-09-14T00:00:00.000Z',
  }));
}
