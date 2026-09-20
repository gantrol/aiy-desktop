export type PackKindDto = 'CONTENT' | 'BUNDLE';

export type PackInstallationStateDto =
  'INSTALLING' | 'UPDATING' | 'INSTALLED' | 'DISABLED' | 'FAILED_NO_USABLE_RELEASE' | 'REMOVAL_PENDING' | 'REMOVED';

export interface PackDto {
  id: string;
  kind: PackKindDto;
  displayName: string;
  description: string;
  contentKinds: string[];
  createdAt: string;
  updatedAt: string;
  retiredAt: string | null;
}

export interface PackReleaseSummaryDto {
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

export interface PackInstallationDto {
  id: string;
  spaceId: string;
  packId: string;
  selectedReleaseId: string | null;
  state: PackInstallationStateDto;
  installationSource: Record<string, unknown>;
  installedAt: string | null;
  disabledAt: string | null;
  removalRequestedAt: string | null;
  lastError: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PackCatalogItemDto {
  pack: PackDto;
  releases: PackReleaseSummaryDto[];
  installation: PackInstallationDto | null;
}

export interface PackReleaseItemDto {
  id: string;
  releaseId: string;
  itemKey: string;
  objectType: string;
  objectRevisionId: string;
  contentHash: string;
  inclusionKind: 'CORE' | 'OPTIONAL' | 'EXAMPLE';
  visibility: 'VISIBLE' | 'HIDDEN' | 'INTERNAL';
  rightsStatus: string;
  metadata: Record<string, unknown>;
  provenance: Record<string, unknown>;
  sortOrder: number;
  createdAt: string;
}

export interface PackDependencyDto {
  id: string;
  releaseId: string;
  targetPackId: string;
  kind: 'REQUIRED' | 'OPTIONAL' | 'RECOMMENDED';
  versionRange: string;
  lockedReleaseId: string | null;
  suggestedRoles: string[];
  capabilityKey: string;
  metadata: Record<string, unknown>;
  sortOrder: number;
  createdAt: string;
}

export interface PackReleaseDto extends PackReleaseSummaryDto {
  manifest: Record<string, unknown>;
  compatibility: Record<string, unknown>;
  defaultRoles: string[];
  licenseSummary: string;
  provenance: Record<string, unknown>;
  createdAt: string;
  items: PackReleaseItemDto[];
  dependencies: PackDependencyDto[];
}

export interface PackInstallExactInput {
  packId: string;
  releaseId: string;
}

export type PackUpdateOperationDto = 'INSTALL' | 'UPDATE' | 'REINSTALL' | 'DOWNGRADE';
export type PackUpdateChangeKindDto = 'ADDED' | 'UPDATED' | 'REMOVED';
export type PackUpdateLocalStateDto = 'FOLLOW_PACK' | 'LOCAL_FORK' | 'CONFLICT';

export interface PackUpdateChangeDto {
  itemKey: string;
  objectType: string;
  changeKind: PackUpdateChangeKindDto;
  localState: PackUpdateLocalStateDto;
}

export interface PackUpdateSummaryDto {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  localForks: number;
  conflicts: number;
}

export interface PackImportPreviewDto {
  blockingConflicts?: number;
  requestId: string;
  packId: string;
  displayName: string;
  operation: PackUpdateOperationDto;
  currentReleaseId: string | null;
  currentVersion: string | null;
  targetReleaseId: string;
  targetVersion: string;
  targetContentHash: string;
  summary: PackUpdateSummaryDto;
  changes: PackUpdateChangeDto[];
  changesTruncated: boolean;
}

export type PackImportLocalResult =
  { status: 'cancelled'; preview: null } | { status: 'preview'; preview: PackImportPreviewDto };

export interface PackApplyImportInput {
  requestId: string;
}

export interface PackApplyImportResult {
  packId: string;
  releaseId: string;
  version: string;
}
