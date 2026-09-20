import { chmodSync, lstatSync, statSync } from 'node:fs';
import path from 'node:path';
import { type ResolvedAssetFile, safeAssetFileName } from '@/main/database/assets/asset-file-repository';
import { trimTrailingCharacters } from '@/shared/string-boundaries';

export const albumsDirectoryName = '图集';
export const termsDirectoryName = '词典';
export const maximumConflictAttempts = 10_000;
export const synchronizationBatchDelayMs = 180;
export const projectionCacheAlgorithmVersion = '2';
export const projectionCacheVersionKey = 'library_file_view_cache_algorithm_version';
export const projectionCacheStateKey = 'library_file_view_cache_state';
export const projectionCacheChangeRowIdKey = 'library_file_view_cache_change_rowid';
export const projectionCacheSchemaVersionKey = 'library_file_view_cache_schema_version';
export const projectionCacheDirectoryCountKey = 'library_file_view_cache_directory_count';
export const projectionCacheLinkCountKey = 'library_file_view_cache_link_count';
export const projectionCacheTermPlacementCountKey = 'library_file_view_cache_term_placement_count';
export const projectionCacheMetadataKeys = [
  projectionCacheVersionKey,
  projectionCacheStateKey,
  projectionCacheChangeRowIdKey,
  projectionCacheSchemaVersionKey,
  projectionCacheDirectoryCountKey,
  projectionCacheLinkCountKey,
  projectionCacheTermPlacementCountKey,
];

export const directProjectionChangeTypeValues: readonly string[] = ['ALBUM', 'ALBUM_MEMBER', 'TERM', 'TERM_MEDIA_LINK'];
export const directProjectionChangeTypes = new Set(directProjectionChangeTypeValues);
export const creationProjectionChangeTypeValues: readonly string[] = [
  'CREATION_OUTPUT_IMPORT',
  'GENERATION_RUN',
  'PROMPT_SERIES',
  'PROMPT_VERSION',
];
export const creationProjectionChangeTypes = new Set(creationProjectionChangeTypeValues);
export const assetProjectionChangeTypes = new Set(['IMAGE_ASSET']);
export const materialProjectionChangeTypes = new Set(['MATERIAL', 'EXTERNAL_MATERIAL_METADATA']);

export type ProjectionDirectoryType = 'ALBUM' | 'TERM_DOMAIN' | 'TERM_TYPE' | 'TERM';
export type ProjectionLinkType = 'ALBUM' | 'TERM';
export type ProjectionState = 'PENDING_CREATE' | 'ACTIVE' | 'PENDING_DELETE' | 'ERROR' | 'RETIRED';

export interface AlbumNode {
  id: string;
  title: string;
  parentId: string | null;
  createdAt: string;
}

export interface TermDirectoryNode {
  id: string;
  name: string;
  domainId: string;
  domainName: string;
  typeId: string;
  typeName: string;
  createdAt: string;
}

export interface IndexedDirectory {
  key: string;
  contextType: ProjectionDirectoryType;
  contextId: string;
  parentKey: string | null;
  state: ProjectionState;
  relativePath: string;
  preferredLabel: string;
}

export interface IndexedLink {
  key: string;
  contextType: ProjectionLinkType;
  contextId: string;
  directoryKey: string;
  state: ProjectionState;
  assetId: string;
  relativePath: string;
  sourceRelativePath: string;
  sourceObjectHash: string;
  preferredName: string;
}

export interface FileViewIndex {
  directories: IndexedDirectory[];
  links: IndexedLink[];
}

export interface DesiredLink {
  key: string;
  asset: ResolvedAssetFile;
  directoryPath: string;
  preferredName: string;
  contextType: ProjectionLinkType;
  contextId: string;
  directoryKey: string;
  allocationOrder: number;
}

export function storedNonNegativeInteger(value: string | undefined) {
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function isPathInsideOrEqual(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function nodeErrorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String((error as NodeJS.ErrnoException).code) : '';
}

export function safeDirectoryLabel(value: string, fallback = '图集') {
  const sentinelExtension = '.aiy-directory';
  const fileName = safeAssetFileName(`${value}${sentinelExtension}`, fallback, sentinelExtension);
  return Array.from(path.basename(fileName, sentinelExtension)).slice(0, 96).join('');
}

export function collisionKey(value: string) {
  return trimTrailingCharacters(value.normalize('NFKC').toLowerCase(), '. ');
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isNumberedDirectoryName(value: string, preferred: string) {
  return value === preferred || new RegExp(`^${escapeRegExp(preferred)} \\(\\d+\\)$`, 'u').test(value);
}

export function isNumberedFileName(value: string, preferred: string) {
  if (value === preferred) return true;
  const extension = path.extname(preferred);
  const stem = path.basename(preferred, extension);
  return new RegExp(`^${escapeRegExp(stem)} \\(\\d+\\)${escapeRegExp(extension)}$`, 'u').test(value);
}

export function numberedDirectoryName(preferred: string, attempt: number) {
  if (attempt === 1) return preferred;
  const suffix = ` (${attempt})`;
  const stem = Array.from(preferred)
    .slice(0, Math.max(1, 96 - Array.from(suffix).length))
    .join('');
  return `${stem}${suffix}`;
}

export function numberedFileName(preferred: string, attempt: number) {
  if (attempt === 1) return preferred;
  const extension = path.extname(preferred);
  const stem = path.basename(preferred, extension);
  const suffix = ` (${attempt})`;
  const boundedStem = Array.from(stem)
    .slice(0, Math.max(1, 120 - Array.from(suffix).length))
    .join('');
  return safeAssetFileName(`${boundedStem}${suffix}${extension}`, 'image', extension);
}

export function sameFile(leftPath: string, rightPath: string) {
  if (path.resolve(leftPath) === path.resolve(rightPath)) return true;
  try {
    const rightEntry = lstatSync(rightPath);
    if (rightEntry.isSymbolicLink() || !rightEntry.isFile()) return false;
    const left = statSync(leftPath, { bigint: true });
    const right = statSync(rightPath, { bigint: true });
    return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino;
  } catch {
    return false;
  }
}

export function ensureReadOnly(filePath: string) {
  const current = statSync(filePath);
  const readOnlyMode = current.mode & ~0o222;
  if (readOnlyMode !== current.mode) chmodSync(filePath, readOnlyMode);
}

export function linkKey(assetId: string, albumId?: string) {
  return albumId ? `ALBUM:${albumId}:${assetId}` : `ALL:${assetId}`;
}

export function termLinkKey(assetId: string, termId: string) {
  return `TERM:${termId}:${assetId}`;
}

export function directoryKey(contextType: ProjectionDirectoryType, contextId: string) {
  return `${contextType}:${contextId}`;
}
