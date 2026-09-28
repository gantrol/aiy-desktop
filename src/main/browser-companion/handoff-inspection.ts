import {
  BROWSER_COMPANION_PROTOCOL_VERSION,
  browserCompanionClaimedRecordSchema,
  browserCompanionDeliveredRecordSchema,
  browserCompanionInspectionSchema,
  browserCompanionRecordBaseSchema,
  type BrowserCompanionRecord,
  type BrowserCompanionResponse,
} from '@/main/browser-companion/protocol';
import {
  browserCompanionHistoryItemSchema,
  type BrowserCompanionHistoryItem,
  type BrowserCompanionTarget,
} from '@/shared/contracts/browser-companion';

type StoredHandoff = { state: 'ready' | 'claimed' | 'delivered'; record: BrowserCompanionRecord | null };

/** A current-task projection is not a claim, lease recovery, or a library/history query. */
export function inspectHandoffRecords(
  target: BrowserCompanionTarget,
  handoffId?: string,
  stored: readonly StoredHandoff[] = [],
): BrowserCompanionResponse {
  if (!handoffId)
    return { protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION, ok: true, kind: 'inspection', handoff: null };
  const error = (code: Extract<BrowserCompanionResponse, { kind: 'error' }>['code']): BrowserCompanionResponse => ({
    protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
    ok: false,
    kind: 'error',
    code,
  });
  const found = stored.filter((entry) => entry.record !== null);
  if (!found.length) return error('HANDOFF_NOT_FOUND');
  if (found.length !== 1) return error('STATE_CONFLICT');
  const { state: directory, record } = found[0]!;
  if (!record || record.handoffId !== handoffId) return error('CORRUPT_STATE');
  if (record.target !== target) return error('TARGET_MISMATCH');
  // A completion is durable before its final rename. Report that fact without repairing files.
  const delivered = browserCompanionDeliveredRecordSchema.safeParse(record);
  const state = delivered.success && directory === 'claimed' ? 'delivered' : directory;
  const valid =
    state === 'ready'
      ? browserCompanionRecordBaseSchema.safeParse(record)
      : state === 'claimed'
        ? browserCompanionClaimedRecordSchema.safeParse(record)
        : delivered;
  if (!valid.success) return error('CORRUPT_STATE');
  return {
    protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
    ok: true,
    kind: 'inspection',
    handoff: browserCompanionInspectionSchema.parse({
      handoffId,
      target,
      state,
      contentKind: record.contentKind,
      title: record.title,
      text: record.text,
      media: record.media,
      createdAt: record.createdAt,
      fillStarted: 'fillStartedAt' in record || state === 'delivered',
      ...(state === 'claimed' && 'leaseExpiresAt' in record ? { claimExpiresAt: record.leaseExpiresAt } : {}),
    }),
  };
}

export function historyItem(
  record: BrowserCompanionRecord,
  state: 'ready' | 'claimed' | 'delivered',
): BrowserCompanionHistoryItem {
  return browserCompanionHistoryItemSchema.parse({
    handoffId: record.handoffId,
    ...(record.batchId ? { batchId: record.batchId } : {}),
    target: record.target,
    source: record.source,
    contentKind: record.contentKind,
    text: record.text,
    mediaCount: record.media.length,
    state,
    createdAt: record.createdAt,
    claimedAt: 'claimedAt' in record ? record.claimedAt : null,
    deliveredAt: 'deliveredAt' in record ? record.deliveredAt : null,
  });
}
