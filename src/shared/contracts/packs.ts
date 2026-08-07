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

export type PackImportLocalResult = { status: 'cancelled'; packId: null } | { status: 'imported'; packId: string };
