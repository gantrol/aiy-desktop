import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { BrowserCompanionBatchStore } from '@/main/browser-companion/batch-store';
import {
  HandoffCalendarCapture,
  type BrowserCompanionCalendarRecorder,
} from '@/main/browser-companion/handoff-calendar-capture';
import {
  XIAOHONGSHU_IMAGE_MAX_BYTES,
  XIAOHONGSHU_IMAGE_TYPES,
  xiaohongshuHandoffError,
} from '@/shared/xiaohongshu-publishing';
import {
  BROWSER_COMPANION_MAX_MEDIA_BYTES,
  BROWSER_COMPANION_MAX_TOTAL_MEDIA_BYTES,
  BROWSER_COMPANION_PROTOCOL_VERSION,
  browserCompanionClaimedRecordSchema,
  browserCompanionDeliveredRecordSchema,
  browserCompanionMediaMimeTypeSchema,
  browserCompanionPersistedRecordSchema,
  browserCompanionRecordBaseSchema,
  browserCompanionCalendarCaptureSchema,
  normalizeBrowserCompanionRecord,
  type BrowserCompanionClaimedRecord,
  type BrowserCompanionDeliveredRecord,
  type BrowserCompanionMedia,
  type BrowserCompanionMediaMimeType,
  type BrowserCompanionResponse,
  type BrowserCompanionRecord,
  type BrowserCompanionRecordBase,
} from '@/main/browser-companion/protocol';
import {
  browserCompanionHistoryItemSchema,
  browserCompanionStageErrorCodeSchema,
  type BrowserCompanionDeleteResult,
  type BrowserCompanionHistoryItem,
  type BrowserCompanionStageInput,
  type BrowserCompanionTarget,
} from '@/shared/contracts/browser-companion';

const MAX_HANDOFF_FILE_BYTES = 2 * 1024 * 1024;
const CLAIM_LEASE_MS = 2 * 60 * 1000;
const ARTICLE_CLAIM_LEASE_MS = 10 * 60 * 1000;
const MAX_HISTORY_ITEMS = 10_000;
const STATE_DIRECTORIES = ['ready', 'claimed', 'delivered'] as const;
const deletionReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    handoffId: browserCompanionRecordBaseSchema.shape.handoffId,
    deletedAt: z.string().datetime({ offset: true }),
    batchId: browserCompanionRecordBaseSchema.shape.batchId,
    target: browserCompanionRecordBaseSchema.shape.target.optional(),
    calendarCapture: browserCompanionCalendarCaptureSchema.optional(),
  })
  .strict()
  .refine((receipt) => !receipt.batchId || Boolean(receipt.target));

const MEDIA_EXTENSIONS: Record<BrowserCompanionMediaMimeType, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

type HandoffStateDirectory = (typeof STATE_DIRECTORIES)[number];

export type BrowserCompanionMediaSource =
  | {
      kind: 'file';
      absolutePath: string;
      suggestedName: string;
      mimeType: string;
    }
  | {
      kind: 'bytes';
      bytes: Uint8Array<ArrayBufferLike>;
      suggestedName: string;
      mimeType: string;
    };

export interface BrowserCompanionMediaFile {
  kind: 'media-file';
  media: BrowserCompanionMedia;
  handle: Awaited<ReturnType<typeof open>>;
}

export class BrowserCompanionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserCompanionStateError';
  }
}

export class BrowserCompanionMediaError extends Error {
  readonly code;

  constructor(
    code: 'X_MEDIA_UNSUPPORTED' | 'X_MEDIA_TOO_LARGE' | 'XIAOHONGSHU_MEDIA_UNSUPPORTED' | 'XIAOHONGSHU_MEDIA_TOO_LARGE',
  ) {
    super(code);
    this.name = 'BrowserCompanionMediaError';
    this.code = browserCompanionStageErrorCodeSchema.parse(code);
  }
}

function hasErrorCode(reason: unknown, code: string): boolean {
  return reason instanceof Error && 'code' in reason && Reflect.get(reason, 'code') === code;
}

function companionError(code: Extract<BrowserCompanionResponse, { kind: 'error' }>['code']) {
  return {
    protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
    ok: false,
    kind: 'error',
    code,
  } as const;
}

function baseRecord(record: BrowserCompanionRecord): BrowserCompanionRecordBase {
  return browserCompanionRecordBaseSchema.parse({
    schemaVersion: 4,
    handoffId: record.handoffId,
    ...(record.batchId ? { batchId: record.batchId } : {}),
    target: record.target,
    source: record.source,
    contentKind: record.contentKind,
    title: record.title,
    ...(record.articleHtml ? { articleHtml: record.articleHtml } : {}),
    ...(record.articleCoverMediaIndex !== undefined ? { articleCoverMediaIndex: record.articleCoverMediaIndex } : {}),
    text: record.text,
    media: record.media,
    createdAt: record.createdAt,
    ...(record.calendarCapture ? { calendarCapture: record.calendarCapture } : {}),
  });
}

function historyItem(record: BrowserCompanionRecord, state: HandoffStateDirectory): BrowserCompanionHistoryItem {
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

async function readBoundedJson(filePath: string): Promise<unknown> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, 'r');
  } catch (reason) {
    if (hasErrorCode(reason, 'ENOENT')) return undefined;
    throw reason;
  }

  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_HANDOFF_FILE_BYTES) {
      throw new BrowserCompanionStateError('Browser companion handoff file has an invalid size');
    }

    const bytes = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset !== bytes.length) {
      throw new BrowserCompanionStateError('Browser companion handoff file is incomplete');
    }

    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, bytes.length)).bytesRead !== 0) {
      throw new BrowserCompanionStateError('Browser companion handoff file changed while reading');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new BrowserCompanionStateError('Browser companion handoff file is not valid JSON');
    }
    return parsed;
  } finally {
    await handle.close();
  }
}

async function readBoundedRecord(filePath: string): Promise<BrowserCompanionRecord | null> {
  const parsed = await readBoundedJson(filePath);
  if (parsed === undefined) return null;
  const validated = browserCompanionPersistedRecordSchema.safeParse(parsed);
  if (!validated.success) {
    throw new BrowserCompanionStateError('Browser companion handoff file does not match its schema');
  }
  return normalizeBrowserCompanionRecord(validated.data);
}

async function writeBoundedJson(filePath: string, value: unknown, flag: 'w' | 'wx'): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  if (bytes.length <= 0 || bytes.length > MAX_HANDOFF_FILE_BYTES) {
    throw new BrowserCompanionStateError('Browser companion handoff exceeds the local size limit');
  }
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
    if (flag === 'wx') await link(temporaryPath, filePath);
    else await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function hashFile(filePath: string, expectedBytes: number): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size !== expectedBytes) {
      throw new BrowserCompanionStateError('Browser companion media changed while staging');
    }
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (offset < expectedBytes) {
      const length = Math.min(buffer.length, expectedBytes - offset);
      const result = await handle.read(buffer, 0, length, offset);
      if (result.bytesRead <= 0) throw new BrowserCompanionStateError('Browser companion media is incomplete');
      hash.update(buffer.subarray(0, result.bytesRead));
      offset += result.bytesRead;
    }
    return hash.digest('hex');
  } finally {
    await handle.close();
  }
}

export class BrowserCompanionHandoffStore {
  private pendingStateOperation: Promise<unknown> = Promise.resolve();
  private readonly calendar = new HandoffCalendarCapture();

  setCalendarRecorder(recorder: BrowserCompanionCalendarRecorder) {
    this.calendar.setRecorder(recorder);
  }

  /** Only durable, host-bound receipts are replayed; inspecting legacy history creates no events. */
  async replayCalendarEvents() {
    return this.withStateLock(async () => {
      await this.ensureDirectories();
      await this.recoverInterruptedClaims();
      for (const state of STATE_DIRECTORIES) {
        for (const record of await this.recordsForState(state)) this.calendar.capture(record);
      }
      for (const handoffId of await this.listIds('deleted')) {
        const stored = await readBoundedJson(this.statePath('deleted', handoffId));
        const receipt = deletionReceiptSchema.safeParse(stored);
        if (receipt.success) this.calendar.capture(receipt.data);
      }
    });
  }
  readonly batches: BrowserCompanionBatchStore;

  constructor(private readonly directoryPath: string) {
    this.batches = new BrowserCompanionBatchStore(path.join(directoryPath, 'batches'));
  }

  // Recovery and history must not observe the intermediate files of a live transition.
  private withStateLock<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.pendingStateOperation.then(operation);
    this.pendingStateOperation = pending.catch(() => undefined);
    return pending;
  }

  private stateDirectory(state: HandoffStateDirectory | 'deleted'): string {
    return path.join(this.directoryPath, state);
  }

  private statePath(state: HandoffStateDirectory | 'deleted', handoffId: string): string {
    return path.join(this.stateDirectory(state), `${handoffId}.json`);
  }

  private mediaDirectory(handoffId: string): string {
    const validatedId = browserCompanionRecordBaseSchema.shape.handoffId.parse(handoffId);
    return path.join(this.directoryPath, 'media', validatedId);
  }

  private mediaPath(handoffId: string, media: BrowserCompanionMedia): string {
    return path.join(this.mediaDirectory(handoffId), `${media.mediaId}${MEDIA_EXTENSIONS[media.mimeType]}`);
  }

  private async ensureDirectories(): Promise<void> {
    const directories = [...STATE_DIRECTORIES, 'deleted'] as const;
    await Promise.all([
      ...directories.map((state) => mkdir(this.stateDirectory(state), { recursive: true })),
      mkdir(path.join(this.directoryPath, 'media'), { recursive: true }),
    ]);
  }

  private async listIds(state: HandoffStateDirectory | 'deleted'): Promise<string[]> {
    const entries = await readdir(this.stateDirectory(state), {
      withFileTypes: true,
    });
    return entries.flatMap((entry) => {
      if (!entry.isFile() || path.extname(entry.name) !== '.json') return [];
      const handoffId = path.basename(entry.name, '.json');
      return browserCompanionRecordBaseSchema.shape.handoffId.safeParse(handoffId).success ? [handoffId] : [];
    });
  }

  private async stageMedia(
    handoffId: string,
    sources: readonly BrowserCompanionMediaSource[],
    target: BrowserCompanionTarget,
  ): Promise<BrowserCompanionMedia[]> {
    if (sources.length === 0) return [];
    if (
      target === 'xiaohongshu' &&
      sources.some((source) => !XIAOHONGSHU_IMAGE_TYPES.some((mimeType) => mimeType === source.mimeType))
    ) {
      throw new BrowserCompanionMediaError('XIAOHONGSHU_MEDIA_UNSUPPORTED');
    }
    if (target === 'x') {
      if (sources.some((source) => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(source.mimeType))) {
        throw new BrowserCompanionMediaError('X_MEDIA_UNSUPPORTED');
      }
    }
    const directory = this.mediaDirectory(handoffId);
    await mkdir(directory, { recursive: false });
    const staged: BrowserCompanionMedia[] = [];
    let totalBytes = 0;

    try {
      for (const source of sources) {
        const mimeType = browserCompanionMediaMimeTypeSchema.parse(source.mimeType);
        let byteSize: number;
        if (source.kind === 'file') {
          const sourceHandle = await open(source.absolutePath, 'r');
          try {
            const stats = await sourceHandle.stat();
            if (!stats.isFile()) {
              throw new BrowserCompanionStateError('Browser companion media exceeds the per-file size limit');
            }
            byteSize = stats.size;
          } finally {
            await sourceHandle.close();
          }
        } else {
          byteSize = source.bytes.byteLength;
        }
        if (target === 'xiaohongshu' && byteSize > XIAOHONGSHU_IMAGE_MAX_BYTES) {
          throw new BrowserCompanionMediaError('XIAOHONGSHU_MEDIA_TOO_LARGE');
        }
        if (byteSize <= 0 || byteSize > BROWSER_COMPANION_MAX_MEDIA_BYTES) {
          throw new BrowserCompanionStateError('Browser companion media exceeds the per-file size limit');
        }
        if (target === 'x' && byteSize > (mimeType === 'image/gif' ? 15 : 5) * 1024 * 1024) {
          throw new BrowserCompanionMediaError('X_MEDIA_TOO_LARGE');
        }
        totalBytes += byteSize;
        if (totalBytes > BROWSER_COMPANION_MAX_TOTAL_MEDIA_BYTES) {
          throw new BrowserCompanionStateError('Browser companion media exceeds the total size limit');
        }

        const mediaId = randomUUID();
        const fileName = path.basename(source.suggestedName);
        const destination = path.join(directory, `${mediaId}${MEDIA_EXTENSIONS[mimeType]}`);
        if (source.kind === 'file') await copyFile(source.absolutePath, destination, constants.COPYFILE_EXCL);
        else
          await writeFile(destination, source.bytes, {
            flag: 'wx',
            mode: 0o600,
          });
        staged.push({
          mediaId,
          fileName,
          mimeType,
          byteSize,
          sha256: await hashFile(destination, byteSize),
        });
      }
      return staged;
    } catch (reason) {
      await rm(directory, { recursive: true, force: true });
      throw reason;
    }
  }

  private async recoverInterruptedClaims(): Promise<void> {
    const now = Date.now();
    for (const handoffId of await this.listIds('claimed')) {
      const claimedPath = this.statePath('claimed', handoffId);
      const record = await readBoundedRecord(claimedPath);
      if (!record) continue;
      if (record.handoffId !== handoffId) {
        throw new BrowserCompanionStateError('Browser companion handoff filename does not match its record');
      }

      const delivered = browserCompanionDeliveredRecordSchema.safeParse(record);
      if (delivered.success) {
        try {
          await rename(claimedPath, this.statePath('delivered', handoffId));
        } catch (reason) {
          if (!hasErrorCode(reason, 'ENOENT')) throw reason;
        }
        this.calendar.capture(delivered.data);
        continue;
      }

      const claimed = browserCompanionClaimedRecordSchema.safeParse(record);
      if (claimed.success && Date.parse(claimed.data.leaseExpiresAt) > now) continue;

      const released = claimed.success ? this.calendar.append(baseRecord(record), 'INTERRUPTED') : baseRecord(record);
      await writeBoundedJson(claimedPath, released, 'w');
      try {
        await rename(claimedPath, this.statePath('ready', handoffId));
      } catch (reason) {
        if (hasErrorCode(reason, 'ENOENT')) continue;
        throw new BrowserCompanionStateError('Browser companion could not recover an interrupted claim');
      }
      this.calendar.capture(released);
    }
  }

  private async recordsForState(state: HandoffStateDirectory): Promise<BrowserCompanionRecord[]> {
    const records: BrowserCompanionRecord[] = [];
    for (const handoffId of await this.listIds(state)) {
      const record = await readBoundedRecord(this.statePath(state, handoffId));
      if (!record) continue;
      if (record.handoffId !== handoffId) {
        throw new BrowserCompanionStateError('Browser companion handoff filename does not match its record');
      }
      const stateValidated =
        state === 'ready'
          ? browserCompanionRecordBaseSchema.safeParse(record)
          : state === 'claimed'
            ? browserCompanionClaimedRecordSchema.safeParse(record)
            : browserCompanionDeliveredRecordSchema.safeParse(record);
      if (!stateValidated.success) {
        throw new BrowserCompanionStateError(`Browser companion ${state} record has an invalid state`);
      }
      records.push(stateValidated.data);
    }
    return records;
  }

  async stage(
    input: BrowserCompanionStageInput,
    mediaSources: readonly BrowserCompanionMediaSource[] = [],
    batchId?: string,
    calendarLibraryId?: string,
  ): Promise<BrowserCompanionHistoryItem> {
    if (input.target === 'xiaohongshu') {
      const error = xiaohongshuHandoffError({
        ...input,
        mediaCount: mediaSources.length,
      });
      if (error) throw new Error(error);
    }
    await this.ensureDirectories();
    const handoffId = randomUUID();
    const media = await this.stageMedia(handoffId, mediaSources, input.target);
    const createdAt = new Date().toISOString();
    const record = browserCompanionRecordBaseSchema.parse({
      schemaVersion: 4,
      handoffId,
      ...(batchId ? { batchId } : {}),
      target: input.target,
      source: input.source,
      contentKind: input.contentKind,
      title: input.title ?? null,
      ...(input.articleHtml ? { articleHtml: input.articleHtml } : {}),
      ...(input.articleCoverMediaIndex !== undefined ? { articleCoverMediaIndex: input.articleCoverMediaIndex } : {}),
      text: input.text,
      media,
      createdAt,
      ...(calendarLibraryId
        ? {
            calendarCapture: {
              libraryId: calendarLibraryId,
              sourceType:
                input.source.kind === 'article'
                  ? 'ARTICLE'
                  : input.source.kind === 'social-post'
                    ? 'SOCIAL_POST_DRAFT'
                    : 'CREATION_DRAFT',
              sourceId: input.source.id,
              events: [{ id: randomUUID(), operation: 'HANDOFF', observedAt: createdAt }],
            },
          }
        : {}),
    });
    try {
      await writeBoundedJson(this.statePath('ready', record.handoffId), record, 'wx');
    } catch (reason) {
      await rm(this.mediaDirectory(handoffId), {
        recursive: true,
        force: true,
      });
      throw reason;
    }
    this.calendar.capture(record);
    return historyItem(record, 'ready');
  }

  private async claimRecord(
    handoffId: string,
    target: BrowserCompanionTarget,
  ): Promise<BrowserCompanionResponse | null> {
    const readyPath = this.statePath('ready', handoffId);
    const claimedPath = this.statePath('claimed', handoffId);
    try {
      await rename(readyPath, claimedPath);
    } catch (reason) {
      if (!hasErrorCode(reason, 'ENOENT')) throw reason;
      if (await readBoundedRecord(claimedPath)) return companionError('DRAFT_ALREADY_CLAIMED');
      return null;
    }

    const moved = await readBoundedRecord(claimedPath);
    const parsed = browserCompanionRecordBaseSchema.safeParse(moved);
    if (!parsed.success || parsed.data.handoffId !== handoffId) {
      throw new BrowserCompanionStateError('Browser companion ready record is invalid');
    }
    if (parsed.data.target !== target) {
      await rename(claimedPath, readyPath);
      return companionError('TARGET_MISMATCH');
    }

    const claimedAt = new Date();
    const claimed = this.calendar.append(
      browserCompanionClaimedRecordSchema.parse({
        ...parsed.data,
        completionToken: randomUUID(),
        claimedAt: claimedAt.toISOString(),
        leaseExpiresAt: new Date(
          claimedAt.getTime() + (parsed.data.contentKind === 'article-body' ? ARTICLE_CLAIM_LEASE_MS : CLAIM_LEASE_MS),
        ).toISOString(),
      }),
      'CLAIM',
      claimedAt.toISOString(),
    );
    try {
      await writeBoundedJson(claimedPath, claimed, 'w');
    } catch (reason) {
      await writeBoundedJson(claimedPath, parsed.data, 'w').catch(() => undefined);
      await rename(claimedPath, readyPath).catch(() => undefined);
      throw reason;
    }

    this.calendar.capture(claimed);

    return {
      protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
      ok: true,
      kind: 'handoff',
      handoff: {
        handoffId: claimed.handoffId,
        completionToken: claimed.completionToken,
        target: claimed.target,
        source: claimed.source,
        contentKind: claimed.contentKind,
        title: claimed.title,
        ...(claimed.articleHtml ? { articleHtml: claimed.articleHtml } : {}),
        ...(claimed.articleCoverMediaIndex !== undefined
          ? { articleCoverMediaIndex: claimed.articleCoverMediaIndex }
          : {}),
        text: claimed.text,
        media: claimed.media,
        createdAt: claimed.createdAt,
        claimedAt: claimed.claimedAt,
      },
    };
  }

  async claim(target: BrowserCompanionTarget, handoffId?: string): Promise<BrowserCompanionResponse> {
    return this.withStateLock(async () => {
      await this.ensureDirectories();
      await this.recoverInterruptedClaims();

      if (handoffId) {
        const response = await this.claimRecord(handoffId, target);
        return response ?? companionError('HANDOFF_NOT_FOUND');
      }

      const candidates = (await this.recordsForState('ready'))
        // Batch tasks can only be claimed by their explicit handoff ID, including by older companions.
        .filter((record) => record.target === target && !record.batchId)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      for (const candidate of candidates) {
        const response = await this.claimRecord(candidate.handoffId, target);
        if (response) return response;
      }
      return {
        protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
        ok: true,
        kind: 'empty',
      };
    });
  }

  private async claimedRecord(
    handoffId: string,
    completionToken: string,
    target: BrowserCompanionTarget,
  ): Promise<BrowserCompanionClaimedRecord | BrowserCompanionResponse> {
    const raw = await readBoundedRecord(this.statePath('claimed', handoffId));
    const claimed = browserCompanionClaimedRecordSchema.safeParse(raw);
    if (!claimed.success) return companionError('HANDOFF_NOT_FOUND');
    if (claimed.data.completionToken !== completionToken) return companionError('HANDOFF_TOKEN_MISMATCH');
    if (claimed.data.target !== target) return companionError('TARGET_MISMATCH');
    return claimed.data;
  }

  async openMedia(
    handoffId: string,
    completionToken: string,
    mediaId: string,
    target: BrowserCompanionTarget,
  ): Promise<BrowserCompanionMediaFile | BrowserCompanionResponse> {
    await this.ensureDirectories();
    const record = await this.claimedRecord(handoffId, completionToken, target);
    if ('kind' in record) return record;
    const media = record.media.find((candidate) => candidate.mediaId === mediaId);
    if (!media) return companionError('MEDIA_NOT_FOUND');

    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(this.mediaPath(handoffId, media), 'r');
    } catch (reason) {
      if (hasErrorCode(reason, 'ENOENT')) return companionError('MEDIA_NOT_FOUND');
      throw reason;
    }

    try {
      const stats = await handle.stat();
      if (stats.isFile() && stats.size === media.byteSize) {
        return { kind: 'media-file', media, handle };
      }
      await handle.close();
      return companionError('MEDIA_CHANGED');
    } catch (reason) {
      await handle.close().catch(() => undefined);
      throw reason;
    }
  }

  async complete(
    handoffId: string,
    completionToken: string,
    target: BrowserCompanionTarget,
  ): Promise<BrowserCompanionResponse> {
    return this.withStateLock(async () => {
      await this.ensureDirectories();
      const record = await this.claimedRecord(handoffId, completionToken, target);
      if ('kind' in record) return record;

      const deliveredAt = new Date().toISOString();
      const delivered = this.calendar.append(
        browserCompanionDeliveredRecordSchema.parse({
          ...baseRecord(record),
          claimedAt: record.claimedAt,
          deliveredAt,
        }),
        'DELIVER',
        deliveredAt,
      );
      const claimedPath = this.statePath('claimed', handoffId);
      await writeBoundedJson(claimedPath, delivered, 'w');
      try {
        await rename(claimedPath, this.statePath('delivered', handoffId));
      } catch (reason) {
        if (!hasErrorCode(reason, 'ENOENT')) throw reason;
        return companionError('HANDOFF_NOT_FOUND');
      }
      this.calendar.capture(delivered);
      return {
        protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
        ok: true,
        kind: 'completed',
        handoffId,
      };
    });
  }

  async getDelivered(
    handoffId: string,
    target: BrowserCompanionTarget,
  ): Promise<BrowserCompanionDeliveredRecord | BrowserCompanionResponse> {
    await this.ensureDirectories();
    const raw = await readBoundedRecord(this.statePath('delivered', handoffId));
    const delivered = browserCompanionDeliveredRecordSchema.safeParse(raw);
    if (!delivered.success) return companionError('HANDOFF_NOT_FOUND');
    if (delivered.data.target !== target) return companionError('TARGET_MISMATCH');
    return delivered.data;
  }

  async release(
    handoffId: string,
    completionToken: string,
    target: BrowserCompanionTarget,
  ): Promise<BrowserCompanionResponse> {
    return this.withStateLock(async () => {
      await this.ensureDirectories();
      const record = await this.claimedRecord(handoffId, completionToken, target);
      if ('kind' in record) return record;

      const claimedPath = this.statePath('claimed', handoffId);
      const released = this.calendar.append(baseRecord(record), 'RELEASE');
      await writeBoundedJson(claimedPath, released, 'w');
      try {
        await rename(claimedPath, this.statePath('ready', handoffId));
      } catch (reason) {
        if (hasErrorCode(reason, 'ENOENT')) return companionError('HANDOFF_NOT_FOUND');
        throw reason;
      }
      this.calendar.capture(released);
      return {
        protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION,
        ok: true,
        kind: 'released',
        handoffId,
      };
    });
  }

  async listHistory(batch?: {
    batchId: string;
    targets: readonly BrowserCompanionTarget[];
  }): Promise<BrowserCompanionHistoryItem[]> {
    return this.withStateLock(async () => {
      await this.ensureDirectories();
      await this.recoverInterruptedClaims();
      const records = await Promise.all(
        STATE_DIRECTORIES.map(async (state) =>
          (await this.recordsForState(state)).map((record) => {
            this.calendar.capture(record);
            return historyItem(record, state);
          }),
        ),
      );
      return records
        .flat()
        .filter((item) => !batch || (item.batchId === batch.batchId && batch.targets.includes(item.target)))
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .slice(0, MAX_HISTORY_ITEMS);
    });
  }

  async deletedBatchHandoffIds(batch: {
    batchId: string;
    targets: readonly BrowserCompanionTarget[];
  }): Promise<string[]> {
    return this.withStateLock(async () => {
      await this.ensureDirectories();
      const ids: string[] = [];
      // These receipts stay outside visible history but remain available for exact cleanup retries.
      for (const handoffId of await this.listIds('deleted')) {
        const stored = await readBoundedJson(this.statePath('deleted', handoffId));
        if (stored === undefined) continue;
        const receipt = deletionReceiptSchema.safeParse(stored);
        const record = receipt.success
          ? receipt.data
          : normalizeBrowserCompanionRecord(browserCompanionPersistedRecordSchema.parse(stored));
        if (
          record.handoffId === handoffId &&
          record.batchId === batch.batchId &&
          record.target &&
          batch.targets.includes(record.target)
        )
          ids.push(handoffId);
      }
      return ids;
    });
  }

  async deleteHistory(handoffIds: readonly string[]): Promise<BrowserCompanionDeleteResult> {
    return this.withStateLock(async () => {
      await this.ensureDirectories();
      await this.recoverInterruptedClaims();
      const deletedHandoffIds: string[] = [];

      for (const handoffId of new Set(handoffIds)) {
        const deletedPath = this.statePath('deleted', handoffId);
        let moved = false;
        for (const state of STATE_DIRECTORIES) {
          try {
            await rename(this.statePath(state, handoffId), deletedPath);
            moved = true;
            break;
          } catch (reason) {
            if (!hasErrorCode(reason, 'ENOENT')) throw reason;
          }
        }
        const stored = await readBoundedJson(deletedPath);
        if (stored === undefined) continue;
        const previousReceipt = deletionReceiptSchema.safeParse(stored);
        let receipt: z.infer<typeof deletionReceiptSchema>;
        if (previousReceipt.success) {
          receipt = previousReceipt.data;
        } else {
          // A crash after rename can leave the old full record here. Recover its exact identity first.
          const record = normalizeBrowserCompanionRecord(browserCompanionPersistedRecordSchema.parse(stored));
          receipt = this.calendar.append(
            deletionReceiptSchema.parse({
              schemaVersion: 1,
              handoffId: record.handoffId,
              deletedAt: new Date().toISOString(),
              target: record.target,
              ...(record.batchId ? { batchId: record.batchId } : {}),
              ...(record.calendarCapture ? { calendarCapture: record.calendarCapture } : {}),
            }),
            'DELETE',
          );
        }
        if (receipt.handoffId !== handoffId) throw new BrowserCompanionStateError('Deleted handoff identity mismatch');
        // Keep only the identity needed to retry cleanup, before touching other durable records.
        if (moved || !previousReceipt.success) await writeBoundedJson(deletedPath, receipt, 'w');
        this.calendar.capture(receipt);
        if (receipt.batchId && receipt.target) {
          await this.batches.deleteItems(receipt.batchId, [receipt.target], handoffId);
        }
        await rm(this.mediaDirectory(handoffId), { recursive: true, force: true });
        // A prior deletion receipt also confirms success, so a UI retry can remove its stale row.
        deletedHandoffIds.push(handoffId);
      }

      return { deletedHandoffIds };
    });
  }
}
