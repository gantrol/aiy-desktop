import { type JsonMap, text } from '@/main/database/core/values';

export type PackKind = 'CONTENT' | 'BUNDLE';

export type PackDependencyKind = 'REQUIRED' | 'OPTIONAL' | 'RECOMMENDED';

export type PackInstallationState =
  'INSTALLING' | 'UPDATING' | 'INSTALLED' | 'DISABLED' | 'FAILED_NO_USABLE_RELEASE' | 'REMOVAL_PENDING' | 'REMOVED';

export type PackInstallOperation = 'INSTALL' | 'UPGRADE' | 'VERIFY' | 'REMOVE';

export type PackInstallAttemptStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'INTERRUPTED' | 'CANCELLED';

export interface LocalSpaceRecord {
  id: string;
  name: string;
  description: string;
  mode: 'LOCAL';
  compatibilityVersion: number;
  backupConfig: JsonMap;
  retentionConfig: JsonMap;
  syncConfig: JsonMap;
  createdAt: string;
  updatedAt: string;
}

export interface SynchronizeLocalSpaceIdentityInput {
  id: string;
  name?: string;
  createdAt?: string;
}

export interface RegisterPackInput {
  id: string;
  kind: PackKind;
  displayName: string;
  description?: string;
  contentKinds?: string[];
}

export interface PackRecord extends RegisterPackInput {
  description: string;
  contentKinds: string[];
  createdAt: string;
  updatedAt: string;
  retiredAt: string | null;
}

export interface PackReleaseSummaryRecord {
  id: string;
  packId: string;
  version: string;
  manifestVersion: number;
  contentHash: string;
  publishedAt: string | null;
  sealedAt: string;
  itemCount: number;
  dependencyCount: number;
}

export interface PackCatalogRecord {
  pack: PackRecord;
  releases: PackReleaseSummaryRecord[];
  installation: PackInstallationRecord | null;
}

export interface InstallExactPackReleaseInput {
  packId: string;
  releaseId: string;
  transactionId?: string;
  source?: JsonMap;
  dependencies?: PackInstallDependencyResolutionInput[];
  verification?: JsonMap;
}

export interface PackReleaseItemInput {
  id?: string;
  itemKey: string;
  objectType: string;
  objectRevisionId: string;
  contentHash: string;
  inclusionKind?: 'CORE' | 'OPTIONAL' | 'EXAMPLE';
  visibility?: 'VISIBLE' | 'HIDDEN' | 'INTERNAL';
  rightsStatus?: string;
  metadata?: JsonMap;
  provenance?: JsonMap;
}

export interface PackReleaseItemRecord {
  id: string;
  releaseId: string;
  itemKey: string;
  objectType: string;
  objectRevisionId: string;
  contentHash: string;
  inclusionKind: 'CORE' | 'OPTIONAL' | 'EXAMPLE';
  visibility: 'VISIBLE' | 'HIDDEN' | 'INTERNAL';
  rightsStatus: string;
  metadata: JsonMap;
  provenance: JsonMap;
  sortOrder: number;
  createdAt: string;
}

export interface PackDependencyInput {
  id?: string;
  targetPackId: string;
  kind: PackDependencyKind;
  versionRange: string;
  lockedReleaseId?: string | null;
  suggestedRoles?: string[];
  capabilityKey?: string;
  metadata?: JsonMap;
}

export interface PackDependencyRecord {
  id: string;
  releaseId: string;
  targetPackId: string;
  kind: PackDependencyKind;
  versionRange: string;
  lockedReleaseId: string | null;
  suggestedRoles: string[];
  capabilityKey: string;
  metadata: JsonMap;
  sortOrder: number;
  createdAt: string;
}

export interface RegisterPackReleaseInput {
  id: string;
  packId: string;
  version: string;
  manifestVersion: number;
  contentHash: string;
  manifest: JsonMap;
  compatibility?: JsonMap;
  defaultRoles?: string[];
  licenseSummary?: string;
  provenance?: JsonMap;
  publishedAt?: string | null;
  items?: PackReleaseItemInput[];
  dependencies?: PackDependencyInput[];
}

export interface PackReleaseRecord {
  id: string;
  packId: string;
  version: string;
  manifestVersion: number;
  contentHash: string;
  manifest: JsonMap;
  compatibility: JsonMap;
  defaultRoles: string[];
  licenseSummary: string;
  provenance: JsonMap;
  publishedAt: string | null;
  createdAt: string;
  sealedAt: string;
  items: PackReleaseItemRecord[];
  dependencies: PackDependencyRecord[];
}

export interface PackInstallDependencyResolutionInput {
  dependencyId: string;
  resolutionKind: 'LOCKED' | 'OMITTED';
  resolvedReleaseId?: string | null;
}

export interface BeginPackInstallAttemptInput {
  packId: string;
  targetReleaseId: string;
  operation: PackInstallOperation;
  transactionId?: string;
  source?: JsonMap;
  dependencies?: PackInstallDependencyResolutionInput[];
}

export interface PackInstallDependencyResolutionRecord {
  id: string;
  attemptId: string;
  dependencyId: string;
  resolutionKind: 'LOCKED' | 'OMITTED';
  resolvedReleaseId: string | null;
  createdAt: string;
}

export interface PackInstallAttemptRecord {
  id: string;
  installationId: string;
  transactionId: string;
  operation: PackInstallOperation;
  targetReleaseId: string;
  status: PackInstallAttemptStatus;
  previousInstallationState: PackInstallationState | null;
  previousReleaseId: string | null;
  source: JsonMap;
  verification: JsonMap | null;
  error: JsonMap | null;
  startedAt: string;
  finishedAt: string | null;
  dependencies: PackInstallDependencyResolutionRecord[];
}

export interface PackInstallationRecord {
  id: string;
  spaceId: string;
  packId: string;
  selectedReleaseId: string | null;
  state: PackInstallationState;
  installationSource: JsonMap;
  installedAt: string | null;
  disabledAt: string | null;
  removalRequestedAt: string | null;
  lastError: JsonMap | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface UpsertContextPackActivationInput {
  id?: string;
  targetType: 'ALBUM' | 'CONVERSATION';
  targetId: string;
  packId: string;
  packReleaseId: string;
  roles: string[];
  priority?: number;
  state?: 'EXPLICIT_ACTIVE' | 'EXPLICIT_DISABLED';
  source: 'USER' | 'BUNDLE_DEFAULT';
  changeReason?: string;
}

export interface ContextPackActivationRecord {
  id: string;
  spaceId: string;
  targetType: 'ALBUM' | 'CONVERSATION';
  targetId: string;
  installationId: string;
  packId: string;
  packReleaseId: string;
  roles: string[];
  priority: number;
  state: 'EXPLICIT_ACTIVE' | 'EXPLICIT_DISABLED';
  source: 'USER' | 'BUNDLE_DEFAULT';
  changeReason: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface UpsertLocalOverrideInput {
  id?: string;
  baseReleaseItemId: string;
  overrideKind: 'REPLACE' | 'HIDE' | 'ORDER' | 'DEFAULT';
  localObjectType?: string;
  localRevisionId?: string;
  localContentHash?: string;
  patch?: JsonMap;
  scopeType: 'SPACE' | 'ALBUM' | 'CONVERSATION';
  scopeId?: string;
  state?: 'ACTIVE' | 'DISABLED' | 'CONFLICTED' | 'DORMANT' | 'SUPERSEDED';
}

export interface LocalOverrideRecord {
  id: string;
  spaceId: string;
  baseReleaseItemId: string;
  overrideKind: 'REPLACE' | 'HIDE' | 'ORDER' | 'DEFAULT';
  localObjectType: string;
  localRevisionId: string;
  localContentHash: string;
  patch: JsonMap;
  scopeType: 'SPACE' | 'ALBUM' | 'CONVERSATION';
  scopeId: string;
  state: 'ACTIVE' | 'DISABLED' | 'CONFLICTED' | 'DORMANT' | 'SUPERSEDED';
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface LinkPackReleaseItemInput {
  id?: string;
  releaseItemId: string;
  localObjectType: string;
  localObjectId: string;
  localRevisionId: string;
  mappingKind: 'INSTALLED_NEW' | 'REUSED_IDENTICAL' | 'MANUALLY_MAPPED' | 'RETAINED_HISTORY';
}

export interface PackObjectLinkRecord extends Required<LinkPackReleaseItemInput> {
  spaceId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export function required(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as JsonMap)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries(entries.map(([key, item]) => [key, normalizeJson(item)]));
  }
  return value;
}

export function json(value: unknown, fallback: unknown) {
  return JSON.stringify(normalizeJson(value ?? fallback));
}

export function parseObject(value: unknown): JsonMap {
  try {
    const parsed = JSON.parse(text(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonMap) : {};
  } catch {
    return {};
  }
}

export function parseOptionalObject(value: unknown): JsonMap | null {
  return value === null || value === undefined || value === '' ? null : parseObject(value);
}

export function parseStrings(value: unknown): string[] {
  try {
    const parsed = JSON.parse(text(value));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function nullableText(value: unknown) {
  return value === null || value === undefined ? null : text(value);
}

export function localSpaceRecord(row: JsonMap): LocalSpaceRecord {
  return {
    id: text(row.id),
    name: text(row.name),
    description: text(row.description),
    mode: text(row.mode) as 'LOCAL',
    compatibilityVersion: Number(row.compatibility_version),
    backupConfig: parseObject(row.backup_config_json),
    retentionConfig: parseObject(row.retention_config_json),
    syncConfig: parseObject(row.sync_config_json),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

export function packRecord(row: JsonMap): PackRecord {
  return {
    id: text(row.id),
    kind: text(row.kind) as PackKind,
    displayName: text(row.display_name),
    description: text(row.description),
    contentKinds: parseStrings(row.content_kinds_json),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    retiredAt: nullableText(row.retired_at),
  };
}

export function releaseItemRecord(row: JsonMap): PackReleaseItemRecord {
  return {
    id: text(row.id),
    releaseId: text(row.release_id),
    itemKey: text(row.item_key),
    objectType: text(row.object_type),
    objectRevisionId: text(row.object_revision_id),
    contentHash: text(row.content_hash),
    inclusionKind: text(row.inclusion_kind) as PackReleaseItemRecord['inclusionKind'],
    visibility: text(row.visibility) as PackReleaseItemRecord['visibility'],
    rightsStatus: text(row.rights_status),
    metadata: parseObject(row.metadata_json),
    provenance: parseObject(row.provenance_json),
    sortOrder: Number(row.sort_order),
    createdAt: text(row.created_at),
  };
}

export function dependencyRecord(row: JsonMap): PackDependencyRecord {
  return {
    id: text(row.id),
    releaseId: text(row.release_id),
    targetPackId: text(row.target_pack_id),
    kind: text(row.dependency_kind) as PackDependencyKind,
    versionRange: text(row.version_range),
    lockedReleaseId: nullableText(row.locked_release_id),
    suggestedRoles: parseStrings(row.suggested_roles_json),
    capabilityKey: text(row.capability_key),
    metadata: parseObject(row.metadata_json),
    sortOrder: Number(row.sort_order),
    createdAt: text(row.created_at),
  };
}

export function installationRecord(row: JsonMap): PackInstallationRecord {
  return {
    id: text(row.id),
    spaceId: text(row.space_id),
    packId: text(row.pack_id),
    selectedReleaseId: nullableText(row.selected_release_id),
    state: text(row.state) as PackInstallationState,
    installationSource: parseObject(row.installation_source_json),
    installedAt: nullableText(row.installed_at),
    disabledAt: nullableText(row.disabled_at),
    removalRequestedAt: nullableText(row.removal_requested_at),
    lastError: parseOptionalObject(row.last_error_json),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    deletedAt: nullableText(row.deleted_at),
  };
}

export function activationRecord(row: JsonMap): ContextPackActivationRecord {
  return {
    id: text(row.id),
    spaceId: text(row.space_id),
    targetType: text(row.target_type) as ContextPackActivationRecord['targetType'],
    targetId: text(row.target_id),
    installationId: text(row.installation_id),
    packId: text(row.pack_id),
    packReleaseId: text(row.pack_release_id),
    roles: parseStrings(row.roles_json),
    priority: Number(row.priority),
    state: text(row.state) as ContextPackActivationRecord['state'],
    source: text(row.activation_source) as ContextPackActivationRecord['source'],
    changeReason: text(row.change_reason),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    deletedAt: nullableText(row.deleted_at),
  };
}

export function overrideRecord(row: JsonMap): LocalOverrideRecord {
  return {
    id: text(row.id),
    spaceId: text(row.space_id),
    baseReleaseItemId: text(row.base_release_item_id),
    overrideKind: text(row.override_kind) as LocalOverrideRecord['overrideKind'],
    localObjectType: text(row.local_object_type),
    localRevisionId: text(row.local_revision_id),
    localContentHash: text(row.local_content_hash),
    patch: parseObject(row.patch_json),
    scopeType: text(row.scope_type) as LocalOverrideRecord['scopeType'],
    scopeId: text(row.scope_id),
    state: text(row.state) as LocalOverrideRecord['state'],
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    deletedAt: nullableText(row.deleted_at),
  };
}

export function objectLinkRecord(row: JsonMap): PackObjectLinkRecord {
  return {
    id: text(row.id),
    spaceId: text(row.space_id),
    releaseItemId: text(row.release_item_id),
    localObjectType: text(row.local_object_type),
    localObjectId: text(row.local_object_id),
    localRevisionId: text(row.local_revision_id),
    mappingKind: text(row.mapping_kind) as PackObjectLinkRecord['mappingKind'],
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    deletedAt: nullableText(row.deleted_at),
  };
}
