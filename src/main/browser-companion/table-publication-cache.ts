import type { BrowserCompanionMediaSource } from '@/main/browser-companion/handoff-store';
import type { BrowserCompanionStageInput } from '@/shared/contracts/browser-companion';
import type { TablePublicationInput, TablePublicationResult } from '@/shared/contracts/table-publication';
import { assertTableGroups } from '@/shared/table-publication-order';

export interface TablePublicationFile {
  bytes: Buffer;
  mimeType: string;
  suggestedName: string;
}
interface Candidate {
  input: TablePublicationInput;
  result: TablePublicationResult;
  files: ReadonlyMap<string, TablePublicationFile>;
  expires: number;
  byteSize: number;
}
const candidates = new Map<string, Candidate>();
const MAX_BYTES = 128 * 1024 * 1024;
export function discardTablePublications(ids: readonly string[], spaceId: string) {
  for (const id of ids) if (candidates.get(id)?.input.expectedSpaceId === spaceId) candidates.delete(id);
}
function expire() {
  const now = Date.now();
  for (const [id, value] of candidates) if (value.expires <= now) candidates.delete(id);
}

export function saveTablePublication(
  input: TablePublicationInput,
  result: TablePublicationResult,
  files: ReadonlyMap<string, TablePublicationFile>,
) {
  expire();
  const byteSize = [...files.values()].reduce((sum, file) => sum + file.bytes.byteLength, 0);
  const total = [...candidates.values()].reduce((sum, item) => sum + item.byteSize, byteSize);
  if (total > MAX_BYTES || candidates.size >= 8) throw new Error('TABLE_PREPARATION_BUSY');
  const id = result.preview.id;
  if (candidates.has(id)) throw new Error('TABLE_PREPARATION_BUSY');
  candidates.set(id, { input, result, files, byteSize, expires: Date.now() + 30 * 60_000 });
  const timer = setTimeout(() => candidates.delete(id), 30 * 60_000);
  timer.unref();
}

export function tablePublicationMedia(identifier: string, spaceId: string): TablePublicationFile | null {
  expire();
  const [id, assetId, extra] = identifier.split('/');
  const candidate = candidates.get(id!);
  if (!candidate || extra || candidate.input.expectedSpaceId !== spaceId) return null;
  return candidate.files.get(assetId!) ?? null;
}

export function preparedTablePublication(
  input: BrowserCompanionStageInput,
  spaceId: string,
): BrowserCompanionMediaSource[] {
  expire();
  const candidate = candidates.get(input.tableConversion?.id ?? '');
  if (!candidate || candidate.input.expectedSpaceId !== spaceId) throw new Error('TABLE_PREVIEW_EXPIRED');
  if (
    candidate.input.target !== input.target ||
    JSON.stringify(candidate.input.source) !== JSON.stringify(input.source) ||
    JSON.stringify(candidate.input.watermark) !== JSON.stringify(input.watermark ?? { kind: 'NONE' })
  )
    throw new Error('TABLE_PREVIEW_EXPIRED');
  const order = input.mediaAssetIds ?? [];
  if (candidate.result.preview.coverAssetId && order[0] !== candidate.result.preview.coverAssetId)
    throw new Error('TABLE_ORDER_CONFLICT');
  assertTableGroups(
    order,
    candidate.result.mediaAssetIds,
    candidate.result.preview.tables.map((table) => table.mediaAssetIds),
  );
  return order.map((id) => ({ kind: 'bytes', ...candidate.files.get(id)! }));
}
