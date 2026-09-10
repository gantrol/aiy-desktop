import type {
  AntigravityCliStatusDto,
  CodexHealth,
  ExtensionConnectionState,
  ExtensionDto,
  ExtensionLanguagePackDto,
  ExtensionManifestDto,
} from '@/shared/contracts';
import {
  ANTIGRAVITY_CLI_EXTENSION_ID,
  CODEX_APP_SERVER_EXTENSION_ID,
  DEEPSEEK_API_EXTENSION_ID,
  EXTERNAL_IMAGE_API_EXTENSION_IDS,
  LEGACY_CODEX_EXTENSION_IDS,
  NATURAL_WATERMARK_EXTENSION_ID,
  OPENAI_IMAGE_API_EXTENSION_ID,
  type ExternalImageApiExtensionId,
} from '@/shared/extension-ids';
import type { LibraryDatabase } from '@/main/database';
import { EXTENSION_HOST_ENGINE_KEY, EXTENSION_HOST_VERSION } from '@/shared/product';
import { BUILTIN_EXTENSION_MANIFESTS } from '@/main/extensions/builtin-manifests';
import { extensionSupportsHost, parseExtensionManifest } from '@/main/extensions/manifest';
import {
  loadExtensionPackage,
  loadExtensionPackages,
  type ExtensionPackageRoot,
} from '@/main/extensions/package-loader';
import { LocalExtensionPackageManager } from '@/main/extensions/local-package-manager';
import type { ExtensionInstallationState } from '@/main/database/extensions/extension-repository';
import {
  extensionRuntimePermissionMatchesTemplate,
  isExtensionPermissionTemplate,
} from '@/shared/extension-permissions';

interface ExtensionRegistryOptions {
  codexHealth(): CodexHealth;
  antigravityCliStatus?(): AntigravityCliStatusDto;
  codexImageDiscoveryStatus?(): { available: boolean; message: string };
  codexVisualizationDiscoveryStatus?(): { available: boolean; message: string };
  openAiImageApiStatus?(): { configured: boolean; usable: boolean; message: string };
  deepSeekApiStatus?(): { configured: boolean; ready: boolean; message: string };
  articleDeliveryStatus?(extensionId: string): { configured: boolean; ready: boolean; message: string };
  externalImageApiStatus?(extensionId: ExternalImageApiExtensionId): {
    configured: boolean;
    usable: boolean;
    message: string;
    permissionRequired?: string | null;
  };
  extensionRoots?: readonly ExtensionPackageRoot[];
}

const externalImageApiExtensionIds = new Set<string>(EXTERNAL_IMAGE_API_EXTENSION_IDS);
const legacyCodexExtensionIds = new Set<string>(LEGACY_CODEX_EXTENSION_IDS);
const disabledByDefaultExtensionIds = new Set<string>([
  ...EXTERNAL_IMAGE_API_EXTENSION_IDS,
  NATURAL_WATERMARK_EXTENSION_ID,
]);

export class ExtensionRegistry {
  private readonly changeListeners = new Set<() => void>();
  onChanged(listener: () => void) {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }
  private notifyChanged() {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch (reason) {
        console.error('[extensions] observer failed', reason);
      }
    }
  }
  private manifests: readonly ExtensionManifestDto[] = [];
  private byId = new Map<string, ExtensionManifestDto>();
  private languageMessagesById: ReadonlyMap<string, Record<string, unknown>> = new Map();
  private packagePathById = new Map<string, string>();
  private sourceById = new Map<string, 'BUILT_IN' | 'LOCAL' | 'MARKETPLACE'>();
  private installationById = new Map<string, ExtensionInstallationState>();
  private readonly protectedManifestIds: ReadonlySet<string>;
  private readonly localPackages: LocalExtensionPackageManager | null;

  constructor(
    private readonly database: LibraryDatabase,
    private readonly options: ExtensionRegistryOptions,
    private readonly hostManifests: readonly ExtensionManifestDto[] = BUILTIN_EXTENSION_MANIFESTS,
  ) {
    this.protectedManifestIds = new Set(hostManifests.map((manifest) => manifest.id));
    const localRoot = options.extensionRoots?.find((root) => root.source === 'LOCAL');
    this.localPackages = localRoot ? new LocalExtensionPackageManager(localRoot.rootPath) : null;
    this.reload();
  }

  reload() {
    const loadedPackages = loadExtensionPackages(this.options.extensionRoots ?? []);
    const definitions: Array<{
      manifest: ExtensionManifestDto;
      source: 'BUILT_IN' | 'LOCAL' | 'MARKETPLACE';
      languageMessages: Record<string, unknown> | null;
      packagePath: string | null;
    }> = this.hostManifests.map((manifest) => ({
      manifest: parseExtensionManifest(manifest),
      source: 'BUILT_IN',
      languageMessages: null,
      packagePath: null,
    }));
    for (const loaded of loadedPackages) {
      if (legacyCodexExtensionIds.has(loaded.manifest.id)) continue;
      const existingIndex = definitions.findIndex((definition) => definition.manifest.id === loaded.manifest.id);
      if (existingIndex >= 0) {
        const existing = definitions[existingIndex]!;
        if (loaded.source === 'LOCAL' && existing.source === 'BUILT_IN' && existing.packagePath) {
          definitions[existingIndex] = { ...loaded, packagePath: loaded.packagePath };
          continue;
        }
        console.warn('[extensions] ignored duplicate extension id', loaded.manifest.id, loaded.packagePath);
        continue;
      }
      if (loaded.source === 'LOCAL' && loaded.manifest.kind === 'LANGUAGE') {
        const localeConflictIndex = definitions.findIndex(
          (definition) =>
            definition.manifest.kind === 'LANGUAGE' &&
            definition.manifest.language?.locale === loaded.manifest.language?.locale,
        );
        if (localeConflictIndex >= 0) {
          const conflict = definitions[localeConflictIndex]!;
          if (conflict.source === 'BUILT_IN' && conflict.packagePath) {
            definitions.splice(localeConflictIndex, 1);
          } else {
            console.warn('[extensions] ignored duplicate language locale', loaded.manifest.id, loaded.packagePath);
            continue;
          }
        }
      }
      definitions.push({ ...loaded, packagePath: loaded.packagePath });
    }
    this.manifests = definitions.map((definition) => definition.manifest);
    this.byId = new Map(this.manifests.map((manifest) => [manifest.id, manifest]));
    this.packagePathById = new Map(
      definitions.flatMap((definition) =>
        definition.packagePath ? [[definition.manifest.id, definition.packagePath] as const] : [],
      ),
    );
    this.sourceById = new Map(definitions.map((definition) => [definition.manifest.id, definition.source]));
    this.languageMessagesById = new Map(
      definitions.flatMap((definition) =>
        definition.languageMessages ? [[definition.manifest.id, definition.languageMessages] as const] : [],
      ),
    );
    if (this.byId.size !== this.manifests.length) throw new Error('Duplicate extension manifest id');
    const languageManifests = this.manifests.filter((manifest) => manifest.kind === 'LANGUAGE');
    if (!languageManifests.length) throw new Error('At least one language extension must be installed');
    const languageLocales = new Set(languageManifests.map((manifest) => manifest.language!.locale));
    if (languageLocales.size !== languageManifests.length) throw new Error('Duplicate language extension locale');
    this.database.reconcileExtensions(
      definitions.map(({ manifest, source }) => ({
        manifest,
        source,
        legacyExtensionIds: manifest.id === CODEX_APP_SERVER_EXTENSION_ID ? LEGACY_CODEX_EXTENSION_IDS : undefined,
        enabledByDefault:
          manifest.kind === 'LANGUAGE' || (source === 'BUILT_IN' && !disabledByDefaultExtensionIds.has(manifest.id)),
        grantRequiredPermissionsByDefault: source === 'BUILT_IN',
      })),
    );
    const installationById = this.refreshInstallations();
    if (!languageManifests.some((manifest) => installationById.get(manifest.id)?.enabled)) {
      this.database.setExtensionEnabled(languageManifests[0].id, true);
      this.refreshInstallations();
    }
  }

  installLocal(sourcePath: string) {
    if (!this.localPackages) throw new Error('Local extension directory is unavailable');
    const candidate = this.localPackages.inspect(sourcePath);
    if (this.protectedManifestIds.has(candidate.manifest.id)) {
      throw new Error(`Built-in extension cannot be replaced: ${candidate.manifest.id}`);
    }
    const conflictingLocale = this.manifests.find(
      (manifest) =>
        manifest.kind === 'LANGUAGE' &&
        candidate.manifest.kind === 'LANGUAGE' &&
        manifest.language?.locale === candidate.manifest.language?.locale &&
        manifest.id !== candidate.manifest.id,
    );
    if (conflictingLocale) {
      const replaceable =
        this.sourceById.get(conflictingLocale.id) === 'BUILT_IN' &&
        this.packagePathById.has(conflictingLocale.id) &&
        !this.protectedManifestIds.has(conflictingLocale.id);
      if (!replaceable) throw new Error(`Language locale is already provided by ${conflictingLocale.id}`);
    }
    const installed = this.localPackages.install(sourcePath);
    this.reload();
    return { extensionId: installed.manifest.id, extensions: this.list() };
  }

  uninstallLocal(extensionId: string) {
    if (!this.localPackages) throw new Error('Local extension directory is unavailable');
    if (this.sourceById.get(extensionId) !== 'LOCAL') throw new Error('Only local extensions can be uninstalled');
    const packagePath = this.packagePathById.get(extensionId);
    if (!packagePath) throw new Error(`Local extension package was not found: ${extensionId}`);
    this.localPackages.uninstall(packagePath);
    this.reload();
    return this.list();
  }

  list(): ExtensionDto[] {
    return this.toDtos(this.refreshInstallations());
  }

  private toDtos(installations: ReadonlyMap<string, ExtensionInstallationState>): ExtensionDto[] {
    return this.manifests.map((manifest) => {
      const installation = installations.get(manifest.id);
      if (!installation) throw new Error(`Built-in extension was not reconciled: ${manifest.id}`);
      const declaredPermissionKeys = new Set([...manifest.permissions, ...manifest.optionalPermissions]);
      const permissions = [
        ...manifest.permissions
          .filter((key) => !isExtensionPermissionTemplate(key))
          .map((key) => ({
            key,
            required: true,
            granted: installation.permissions.get(key) === true,
            runtimeScoped: false,
          })),
        ...manifest.optionalPermissions
          .filter((key) => !isExtensionPermissionTemplate(key))
          .map((key) => ({
            key,
            required: false,
            granted: installation.permissions.get(key) === true,
            runtimeScoped: false,
          })),
        ...[...installation.permissions.entries()].flatMap(([key, granted]) =>
          granted && !declaredPermissionKeys.has(key) && this.isRuntimePermission(manifest, key)
            ? [{ key, required: false, granted, runtimeScoped: true }]
            : [],
        ),
      ];
      const compatible = extensionSupportsHost(manifest.engines[EXTENSION_HOST_ENGINE_KEY], EXTENSION_HOST_VERSION);
      const requiredPermissionsGranted = permissions.every((permission) => !permission.required || permission.granted);
      const connection = this.connectionFor(manifest, installation.enabled, compatible, requiredPermissionsGranted);
      return {
        manifest,
        source: installation.source,
        enabled: installation.enabled,
        compatible,
        effective: connection.state === 'READY',
        connectionState: connection.state,
        connectionMessage: connection.message,
        permissions,
        installedAt: installation.installedAt,
        updatedAt: installation.updatedAt,
      };
    });
  }

  listLanguagePacks(): ExtensionLanguagePackDto[] {
    if (import.meta.env.DEV) this.refreshDevelopmentLanguageMessages();
    return this.manifests.flatMap((manifest) => {
      const messages = this.languageMessagesById.get(manifest.id);
      if (manifest.kind !== 'LANGUAGE' || !manifest.language || !messages) return [];
      return [
        {
          extensionId: manifest.id,
          locale: manifest.language.locale,
          htmlLanguage: manifest.language.htmlLanguage,
          messages,
        },
      ];
    });
  }

  private refreshDevelopmentLanguageMessages() {
    const refreshed = new Map(this.languageMessagesById);
    for (const manifest of this.manifests) {
      if (manifest.kind !== 'LANGUAGE') continue;
      const packagePath = this.packagePathById.get(manifest.id);
      const source = this.sourceById.get(manifest.id);
      if (!packagePath || !source) continue;
      try {
        const loaded = loadExtensionPackage(packagePath, source);
        if (loaded.manifest.id !== manifest.id || !loaded.languageMessages) continue;
        refreshed.set(manifest.id, loaded.languageMessages);
      } catch (error) {
        console.warn('[extensions] kept previous development language catalog', packagePath, error);
      }
    }
    this.languageMessagesById = refreshed;
  }

  get(extensionId: string) {
    return this.list().find((extension) => extension.manifest.id === extensionId) ?? null;
  }

  /** Persisted activation gate. Runtime connection readiness is checked by the provider itself. */
  isActivated(extensionId: string) {
    const manifest = this.byId.get(extensionId);
    const installation = this.installationById.get(extensionId);
    if (!manifest || !installation) return false;
    return (
      installation.enabled &&
      extensionSupportsHost(manifest.engines[EXTENSION_HOST_ENGINE_KEY], EXTENSION_HOST_VERSION) &&
      manifest.permissions.every((permission) => installation.permissions.get(permission) === true)
    );
  }

  isPermissionGranted(extensionId: string, permission: string) {
    const manifest = this.requireManifest(extensionId);
    const declared = [...manifest.permissions, ...manifest.optionalPermissions].includes(permission);
    if ((!declared || isExtensionPermissionTemplate(permission)) && !this.isRuntimePermission(manifest, permission)) {
      return false;
    }
    const installation = this.installationById.get(extensionId);
    return installation?.permissions.get(permission) === true;
  }

  declaresPermission(extensionId: string, permission: string) {
    const manifest = this.requireManifest(extensionId);
    return [...manifest.permissions, ...manifest.optionalPermissions].includes(permission);
  }

  grantRuntimePermission(extensionId: string, template: string, permission: string) {
    const manifest = this.requireManifest(extensionId);
    if (!manifest.optionalPermissions.includes(template) || !isExtensionPermissionTemplate(template)) {
      throw new Error(`Extension does not declare runtime permission template: ${template}`);
    }
    if (!extensionRuntimePermissionMatchesTemplate(template, permission)) {
      throw new Error(`Runtime permission ${permission} does not match ${template}`);
    }
    const alreadyGranted = this.installationById.get(extensionId)?.permissions.get(permission) === true;
    if (!alreadyGranted) {
      this.database.setExtensionPermission(extensionId, permission, true);
      this.refreshInstallations();
    }
    return !alreadyGranted;
  }

  revokeRuntimePermissionsExcept(extensionId: string, template: string, retainedPermission: string | null) {
    const manifest = this.requireManifest(extensionId);
    if (!manifest.optionalPermissions.includes(template) || !isExtensionPermissionTemplate(template)) {
      throw new Error(`Extension does not declare runtime permission template: ${template}`);
    }
    const installation = this.installationById.get(extensionId);
    if (!installation) return;
    const declared = new Set([...manifest.permissions, ...manifest.optionalPermissions]);
    for (const [permission, granted] of installation.permissions) {
      if (
        granted &&
        !declared.has(permission) &&
        permission !== retainedPermission &&
        extensionRuntimePermissionMatchesTemplate(template, permission)
      ) {
        this.database.setExtensionPermission(extensionId, permission, false);
      }
    }
    this.refreshInstallations();
  }

  setEnabled(extensionId: string, enabled: boolean) {
    const manifest = this.requireManifest(extensionId);
    if (!enabled && manifest.kind === 'LANGUAGE') {
      const otherLanguageEnabled = this.list().some(
        (extension) =>
          extension.manifest.kind === 'LANGUAGE' && extension.manifest.id !== extensionId && extension.enabled,
      );
      const target = this.get(extensionId);
      if (target?.enabled && !otherLanguageEnabled) {
        throw new Error('At least one language plugin must remain enabled');
      }
    }
    this.database.setExtensionEnabled(extensionId, enabled);
    const result = this.toDtos(this.refreshInstallations());
    this.notifyChanged();
    return result;
  }

  setPermission(extensionId: string, permission: string, granted: boolean) {
    const manifest = this.requireManifest(extensionId);
    const declared = [...manifest.permissions, ...manifest.optionalPermissions].includes(permission);
    const runtime = this.isRuntimePermission(manifest, permission);
    if ((!declared || isExtensionPermissionTemplate(permission)) && !runtime) {
      throw new Error(`Extension does not declare permission: ${permission}`);
    }
    if (runtime && granted) throw new Error('Runtime-scoped permissions can only be granted by their owning workflow');
    this.database.setExtensionPermission(extensionId, permission, granted);
    const result = this.toDtos(this.refreshInstallations());
    this.notifyChanged();
    return result;
  }

  private refreshInstallations() {
    this.installationById = new Map(
      this.database.listExtensionInstallations().map((installation) => [installation.extensionId, installation]),
    );
    return this.installationById;
  }

  private requireManifest(extensionId: string) {
    const manifest = this.byId.get(extensionId);
    if (!manifest) throw new Error(`Unknown extension: ${extensionId}`);
    return manifest;
  }

  private isRuntimePermission(manifest: ExtensionManifestDto, permission: string) {
    return manifest.optionalPermissions.some(
      (template) =>
        isExtensionPermissionTemplate(template) && extensionRuntimePermissionMatchesTemplate(template, permission),
    );
  }

  private connectionFor(
    manifest: ExtensionManifestDto,
    enabled: boolean,
    compatible: boolean,
    requiredPermissionsGranted: boolean,
  ): { state: ExtensionConnectionState; message: string } {
    if (!enabled) return { state: 'DISABLED', message: 'Extension disabled' };
    if (!compatible) return { state: 'UNAVAILABLE', message: 'Incompatible application version' };
    if (!requiredPermissionsGranted) {
      return { state: 'PERMISSION_REQUIRED', message: 'Required permission has not been granted' };
    }
    if (manifest.id === CODEX_APP_SERVER_EXTENSION_ID) {
      const health = this.options.codexHealth();
      if (health.state === 'checking') return { state: 'CONNECTING', message: health.message };
      return health.state === 'ready'
        ? { state: 'READY', message: health.message }
        : { state: 'UNAVAILABLE', message: health.message };
    }
    if (manifest.id === ANTIGRAVITY_CLI_EXTENSION_ID) {
      const status = this.options.antigravityCliStatus?.();
      if (!status || status.state === 'checking') {
        return { state: 'CONNECTING', message: status?.message || 'Checking local Antigravity CLI' };
      }
      return status.state === 'ready'
        ? { state: 'READY', message: status.message }
        : { state: 'UNAVAILABLE', message: status.message };
    }
    if (manifest.id === OPENAI_IMAGE_API_EXTENSION_ID) {
      const status = this.options.openAiImageApiStatus?.();
      if (!status?.configured)
        return {
          state: 'NEEDS_CONFIGURATION',
          message: status?.message || 'OpenAI API connection is not configured',
        };
      return status.usable
        ? { state: 'READY', message: status.message }
        : { state: 'UNAVAILABLE', message: status.message };
    }
    if (manifest.id === DEEPSEEK_API_EXTENSION_ID) {
      const status = this.options.deepSeekApiStatus?.();
      if (!status?.configured)
        return {
          state: 'NEEDS_CONFIGURATION',
          message: status?.message || 'DeepSeek API connection is not configured',
        };
      return status.ready
        ? { state: 'READY', message: status.message }
        : { state: 'UNAVAILABLE', message: status.message };
    }
    if (manifest.configuration?.kind === 'ARTICLE_DELIVERY') {
      const status = this.options.articleDeliveryStatus?.(manifest.id);
      if (!status?.configured) {
        return {
          state: 'NEEDS_CONFIGURATION',
          message: status?.message || 'Delivery connection is not configured',
        };
      }
      return status.ready
        ? { state: 'READY', message: status.message }
        : { state: 'UNAVAILABLE', message: status.message };
    }
    if (externalImageApiExtensionIds.has(manifest.id)) {
      const status = this.options.externalImageApiStatus?.(manifest.id as ExternalImageApiExtensionId);
      if (!status?.configured)
        return {
          state: 'NEEDS_CONFIGURATION',
          message: status?.message || 'Image API connection is not configured',
        };
      if (status.permissionRequired)
        return {
          state: 'PERMISSION_REQUIRED',
          message: `Endpoint requires permission ${status.permissionRequired}`,
        };
      return status.usable
        ? { state: 'READY', message: status.message }
        : { state: 'UNAVAILABLE', message: status.message };
    }
    // The renderer localizes this stable state; no redundant English detail is needed.
    return { state: 'READY', message: '' };
  }
}
