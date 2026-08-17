import type {
  ExtensionReconcileEntry,
  ExtensionThreadScopeKind,
} from '@/main/database/extensions/extension-repository';
import type {
  BeginPackInstallAttemptInput,
  InstallExactPackReleaseInput,
  LinkPackReleaseItemInput,
  RegisterPackInput,
  RegisterPackReleaseInput,
  SynchronizeLocalSpaceIdentityInput,
  UpsertContextPackActivationInput,
  UpsertLocalOverrideInput,
} from '@/main/database/packs/pack-repository';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { JsonMap } from '@/main/database/core/values';
import type { ExtensionManifestDto } from '@/shared/contracts';

export function createExtensionPackApi(repositories: Pick<LibraryDatabaseRepositories, 'extensions' | 'packs'>) {
  return {
    reconcileBuiltInExtensions(manifests: readonly ExtensionManifestDto[]) {
      return repositories.extensions.reconcileBuiltIns(manifests);
    },

    reconcileExtensions(entries: readonly ExtensionReconcileEntry[]) {
      return repositories.extensions.reconcile(entries);
    },

    listExtensionInstallations() {
      return repositories.extensions.listInstallations();
    },

    setExtensionEnabled(extensionId: string, enabled: boolean) {
      return repositories.extensions.setEnabled(extensionId, enabled);
    },

    setExtensionPermission(extensionId: string, permission: string, granted: boolean) {
      return repositories.extensions.setPermission(extensionId, permission, granted);
    },

    getExtensionThreadBinding(extensionId: string, scopeKind: ExtensionThreadScopeKind, scopeId: string) {
      return repositories.extensions.getThreadBinding(extensionId, scopeKind, scopeId);
    },

    bindExtensionThread(input: {
      extensionId: string;
      scopeKind: ExtensionThreadScopeKind;
      scopeId: string;
      threadId: string;
      threadName: string;
    }) {
      return repositories.extensions.bindThread(input);
    },

    getLocalSpace() {
      return repositories.packs.getLocalSpace();
    },

    synchronizeLocalSpaceIdentity(input: SynchronizeLocalSpaceIdentityInput) {
      return repositories.packs.synchronizeLocalSpaceIdentity(input);
    },

    renameLocalSpace(name: string) {
      return repositories.packs.renameLocalSpace(name);
    },

    listPackCatalog() {
      return repositories.packs.listPackCatalog();
    },

    registerPack(input: RegisterPackInput) {
      return repositories.packs.registerPack(input);
    },

    registerPackRelease(input: RegisterPackReleaseInput) {
      return repositories.packs.registerPackRelease(input);
    },

    getPackRelease(releaseId: string) {
      return repositories.packs.getPackRelease(releaseId);
    },

    beginPackInstallAttempt(input: BeginPackInstallAttemptInput) {
      return repositories.packs.beginPackInstallAttempt(input);
    },

    installExactPackRelease(input: InstallExactPackReleaseInput) {
      return repositories.packs.installExactPackRelease(input);
    },

    completePackInstallAttempt(attemptId: string, verification: JsonMap = {}) {
      return repositories.packs.completePackInstallAttempt(attemptId, verification);
    },

    failPackInstallAttempt(attemptId: string, error: JsonMap) {
      return repositories.packs.failPackInstallAttempt(attemptId, error);
    },

    cancelPackInstallAttempt(attemptId: string, reason: JsonMap = {}) {
      return repositories.packs.cancelPackInstallAttempt(attemptId, reason);
    },

    getPackInstallAttempt(attemptId: string) {
      return repositories.packs.getPackInstallAttempt(attemptId);
    },

    listPackInstallations(includeRemoved = false) {
      return repositories.packs.listPackInstallations(includeRemoved);
    },

    setPackInstallationDisabled(packId: string, disabled: boolean) {
      return repositories.packs.setPackInstallationDisabled(packId, disabled);
    },

    upsertContextPackActivation(input: UpsertContextPackActivationInput) {
      return repositories.packs.upsertContextPackActivation(input);
    },

    listContextPackActivations(targetType: 'ALBUM' | 'CONVERSATION', targetId: string) {
      return repositories.packs.listContextPackActivations(targetType, targetId);
    },

    deleteContextPackActivation(activationId: string) {
      return repositories.packs.deleteContextPackActivation(activationId);
    },

    upsertLocalOverride(input: UpsertLocalOverrideInput) {
      return repositories.packs.upsertLocalOverride(input);
    },

    listLocalOverrides(includeDeleted = false) {
      return repositories.packs.listLocalOverrides(includeDeleted);
    },

    deleteLocalOverride(overrideId: string) {
      return repositories.packs.deleteLocalOverride(overrideId);
    },

    linkPackReleaseItem(input: LinkPackReleaseItemInput) {
      return repositories.packs.linkPackReleaseItem(input);
    },

    deletePackObjectLink(linkId: string) {
      return repositories.packs.deletePackObjectLink(linkId);
    },
  };
}

export type ExtensionPackApi = ReturnType<typeof createExtensionPackApi>;
