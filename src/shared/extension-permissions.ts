export const EXTENSION_PERMISSION = {
  accountReadCodexRateLimits: 'account.read:codex-rate-limits',
  browserHandoffWeibo: 'browser.handoff:weibo',
  codexManageExtensionThreads: 'codex.manage:extension-owned-threads',
  credentialsUseAlibabaModelStudioApiKey: 'credentials.use:alibaba-model-studio-api-key',
  credentialsUseDeepSeekApiKey: 'credentials.use:deepseek-api-key',
  credentialsUseGoogleGeminiApiKey: 'credentials.use:google-gemini-api-key',
  credentialsUseOpenAiApiKey: 'credentials.use:openai-api-key',
  credentialsUseVolcengineArkApiKey: 'credentials.use:volcengine-ark-api-key',
  filesystemReadCodexGeneratedImages: 'filesystem.read:codex-generated-images',
  filesystemReadCodexSessionMetadata: 'filesystem.read:codex-session-metadata',
  filesystemReadCodexSessionUsage: 'filesystem.read:codex-session-usage',
  filesystemReadCodexThreadContent: 'filesystem.read:codex-thread-content',
  filesystemReadCodexVisualizations: 'filesystem.read:codex-visualizations',
  integrationConnectCodexAppServer: 'integration.connect:codex-app-server',
  libraryCreateCreations: 'library.create:creations',
  libraryReadSelectedReferences: 'library.read:selected-references',
  processExecuteAntigravityCli: 'process.execute:antigravity-cli',
} as const;

export const EXTENSION_PERMISSION_TEMPLATE = {
  userConfiguredDeepSeekVisionEndpoint: 'network:user-configured-deepseek-vision-endpoint',
  userConfiguredHttpsEndpoint: 'network:user-configured-https-endpoint',
} as const;

const declaredFixedPermissions = new Set<string>(Object.values(EXTENSION_PERMISSION));
const permissionTemplates = new Set<string>(Object.values(EXTENSION_PERMISSION_TEMPLATE));

const legacyPermissionAliases: Readonly<Record<string, readonly string[]>> = {
  [EXTENSION_PERMISSION.accountReadCodexRateLimits]: ['codex:account-rate-limits'],
  [EXTENSION_PERMISSION.codexManageExtensionThreads]: ['codex:threads'],
  [EXTENSION_PERMISSION.credentialsUseAlibabaModelStudioApiKey]: ['secrets:alibaba-model-studio-api-key'],
  [EXTENSION_PERMISSION.credentialsUseDeepSeekApiKey]: ['secrets:deepseek-api-key'],
  [EXTENSION_PERMISSION.credentialsUseGoogleGeminiApiKey]: ['secrets:google-gemini-api-key'],
  [EXTENSION_PERMISSION.credentialsUseOpenAiApiKey]: ['secrets:openai-api-key'],
  [EXTENSION_PERMISSION.credentialsUseVolcengineArkApiKey]: ['secrets:volcengine-ark-api-key'],
  [EXTENSION_PERMISSION.integrationConnectCodexAppServer]: ['codex:app-server'],
  [EXTENSION_PERMISSION.libraryCreateCreations]: ['library.write:creations'],
  [EXTENSION_PERMISSION.libraryReadSelectedReferences]: ['library.read:references'],
  [EXTENSION_PERMISSION.processExecuteAntigravityCli]: ['antigravity:cli'],
};

function parsedNetworkPermission(permission: string): URL | null {
  if (!permission.startsWith('network:')) return null;
  try {
    const parsed = new URL(permission.slice('network:'.length));
    return permission === `network:${parsed.origin}` ? parsed : null;
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

export function isExtensionPermissionTemplate(permission: string) {
  return permissionTemplates.has(permission);
}

export function extensionPermissionLegacyAliases(permission: string): readonly string[] {
  return legacyPermissionAliases[permission] ?? [];
}

export function isExactNetworkExtensionPermission(permission: string) {
  const parsed = parsedNetworkPermission(permission);
  return Boolean(
    parsed && (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))),
  );
}

export function extensionRuntimePermissionMatchesTemplate(template: string, permission: string) {
  const parsed = parsedNetworkPermission(permission);
  if (!parsed) return false;
  if (template === EXTENSION_PERMISSION_TEMPLATE.userConfiguredHttpsEndpoint) {
    return parsed.protocol === 'https:';
  }
  if (template === EXTENSION_PERMISSION_TEMPLATE.userConfiguredDeepSeekVisionEndpoint) {
    return parsed.protocol === 'https:' || (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname));
  }
  return false;
}

export function validateDeclaredExtensionPermission(permission: string) {
  if (declaredFixedPermissions.has(permission) || permissionTemplates.has(permission)) return;
  if (isExactNetworkExtensionPermission(permission)) return;
  if (/^credentials\.use:[a-z0-9][a-z0-9._-]{1,159}$/.test(permission)) return;
  throw new Error(`Unsupported extension permission: ${permission}`);
}

export function networkOriginExtensionPermission(endpoint: string) {
  const parsed = new URL(endpoint);
  const permission = `network:${parsed.origin}`;
  if (!isExactNetworkExtensionPermission(permission)) {
    throw new Error('Extension network permission requires HTTPS or an HTTP loopback origin');
  }
  return permission;
}
