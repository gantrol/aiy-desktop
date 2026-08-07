import type {
  CodexHealth,
  ExtensionConnectionState,
  ExtensionDto,
  ExtensionLanguagePackDto,
  ExtensionManifestDto,
} from '@/shared/contracts';
import {
  CODEX_APP_SERVER_EXTENSION_ID,
  CODEX_IMAGE_DISCOVERY_EXTENSION_ID,
  DEEPSEEK_API_EXTENSION_ID,
  EXTERNAL_IMAGE_API_EXTENSION_IDS,
  OPENAI_IMAGE_API_EXTENSION_ID,
  type ExternalImageApiExtensionId,
} from '@/shared/extension-ids';
import type { LibraryDatabase } from '@/main/database';
import { EXTENSION_HOST_ENGINE_KEY, PRODUCT_VERSION } from '@/shared/product';
import { BUILTIN_EXTENSION_MANIFESTS } from '@/main/extensions/builtin-manifests';
import { extensionSupportsHost, parseExtensionManifest } from '@/main/extensions/manifest';
import { loadExtensionPackages, type ExtensionPackageRoot } from '@/main/extensions/package-loader';
import { LocalExtensionPackageManager } from '@/main/extensions/local-package-manager';

interface ExtensionRegistryOptions {
  codexHealth(): CodexHealth;
  codexImageDiscoveryStatus?(): { available: boolean; message: string };
  openAiImageApiStatus?(): { configured: boolean; usable: boolean; message: string };
  deepSeekApiStatus?(): { configured: boolean; ready: boolean; message: string };
  externalImageApiStatus?(extensionId: ExternalImageApiExtensionId): {
    configured: boolean;
    usable: boolean;
    message: string;
    permissionRequired?: string | null;
  };
  extensionRoots?: readonly ExtensionPackageRoot[];
}

const externalImageApiExtensionIds = new Set<string>(EXTERNAL_IMAGE_API_EXTENSION_IDS);

export class ExtensionRegistry {
  private manifests: readonly ExtensionManifestDto[] = [];
  private byId = new Map<string, ExtensionManifestDto>();
  private languageMessagesById: ReadonlyMap<string, Record<string, unknown>> = new Map();
  private packagePathById = new Map<string, string>();
  private sourceById = new Map<string, 'BUILT_IN' | 'LOCAL' | 'MARKETPLACE'>();
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
        enabledByDefault: !externalImageApiExtensionIds.has(manifest.id),
      })),
    );
    const installationById = new Map(
      this.database.listExtensionInstallations().map((item) => [item.extensionId, item]),
    );
    if (!languageManifests.some((manifest) => installationById.get(manifest.id)?.enabled)) {
      this.database.setExtensionEnabled(languageManifests[0].id, true);
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
    const installations = new Map(
      this.database.listExtensionInstallations().map((installation) => [installation.extensionId, installation]),
    );
    return this.manifests.map((manifest) => {
      const installation = installations.get(manifest.id);
      if (!installation) throw new Error(`Built-in extension was not reconciled: ${manifest.id}`);
      const permissions = [
        ...manifest.permissions.map((key) => ({
          key,
          required: true,
          granted: installation.permissions.get(key) === true,
        })),
        ...manifest.optionalPermissions.map((key) => ({
          key,
          required: false,
          granted: installation.permissions.get(key) === true,
        })),
      ];
      const compatible = extensionSupportsHost(manifest.engines[EXTENSION_HOST_ENGINE_KEY], PRODUCT_VERSION);
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

  get(extensionId: string) {
    return this.list().find((extension) => extension.manifest.id === extensionId) ?? null;
  }

  /** Persisted activation gate. Runtime connection readiness is checked by the provider itself. */
  isActivated(extensionId: string) {
    const extension = this.get(extensionId);
    if (!extension) return false;
    return (
      extension.enabled &&
      extension.compatible &&
      extension.permissions.every((permission) => !permission.required || permission.granted)
    );
  }

  isPermissionGranted(extensionId: string, permission: string) {
    const manifest = this.requireManifest(extensionId);
    if (![...manifest.permissions, ...manifest.optionalPermissions].includes(permission)) return false;
    const installation = this.database
      .listExtensionInstallations()
      .find((candidate) => candidate.extensionId === extensionId);
    return installation?.permissions.get(permission) === true;
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
    return this.list();
  }

  setPermission(extensionId: string, permission: string, granted: boolean) {
    const manifest = this.requireManifest(extensionId);
    if (![...manifest.permissions, ...manifest.optionalPermissions].includes(permission)) {
      throw new Error(`Extension does not declare permission: ${permission}`);
    }
    this.database.setExtensionPermission(extensionId, permission, granted);
    return this.list();
  }

  private requireManifest(extensionId: string) {
    const manifest = this.byId.get(extensionId);
    if (!manifest) throw new Error(`Unknown extension: ${extensionId}`);
    return manifest;
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
    if (manifest.id === CODEX_IMAGE_DISCOVERY_EXTENSION_ID) {
      const status = this.options.codexImageDiscoveryStatus?.();
      if (!status) return { state: 'READY', message: 'Ready' };
      return status.available
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
    return { state: 'READY', message: 'Ready' };
  }
}
