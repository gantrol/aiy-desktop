import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BROWSER_COMPANION_MAX_MEDIA_BYTES,
  BROWSER_COMPANION_MAX_TOTAL_MEDIA_BYTES,
  BROWSER_COMPANION_PROTOCOL_VERSION,
  browserCompanionClaimedRecordSchema,
  browserCompanionDeliveredRecordSchema,
  browserCompanionMediaMimeTypeSchema,
  browserCompanionPersistedRecordSchema,
  browserCompanionRecordBaseSchema,
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
  type BrowserCompanionDeleteResult,
  type BrowserCompanionHistoryItem,
  type BrowserCompanionStageInput,
  type BrowserCompanionTarget,
} from '@/shared/contracts/browser-companion';

const MAX_HANDOFF_FILE_BYTES = 64 * 1024;
const CLAIM_LEASE_MS = 2 * 60 * 1000;
const MAX_HISTORY_ITEMS = 10_000;
const STATE_DIRECTORIES = ['ready', 'claimed', 'delivered'] as const;

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
    target: record.target,
    source: record.source,
    contentKind: record.contentKind,
    title: record.title,
    text: record.text,
    media: record.media,
    createdAt: record.createdAt,
  });
}

function historyItem(record: BrowserCompanionRecord, state: HandoffStateDirectory): BrowserCompanionHistoryItem {
  return browserCompanionHistoryItemSchema.parse({
    handoffId: record.handoffId,
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

async function readBoundedRecord(filePath: string): Promise<BrowserCompanionRecord | null> {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(filePath, 'r');
  } catch (reason) {
    if (hasErrorCode(reason, 'ENOENT')) return null;
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
    const validated = browserCompanionPersistedRecordSchema.safeParse(parsed);
    if (!validated.success) {
      throw new BrowserCompanionStateError('Browser companion handoff file does not match its schema');
    }
    return normalizeBrowserCompanionRecord(validated.data);
  } finally {
    await handle.close();
  }
}

async function writeBoundedJson(filePath: string, value: unknown, flag: 'w' | 'wx'): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  if (bytes.length <= 0 || bytes.length > MAX_HANDOFF_FILE_BYTES) {
    throw new BrowserCompanionStateError('Browser companion handoff exceeds the local size limit');
  }
  await writeFile(filePath, bytes, { flag, mode: 0o600 });
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
  constructor(private readonly directoryPath: string) {}

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

  private async listIds(state: HandoffStateDirectory): Promise<string[]> {
    const entries = await readdir(this.stateDirectory(state), { withFileTypes: true });
    return entries.flatMap((entry) => {
      if (!entry.isFile() || path.extname(entry.name) !== '.json') return [];
      const handoffId = path.basename(entry.name, '.json');
      return browserCompanionRecordBaseSchema.shape.handoffId.safeParse(handoffId).success ? [handoffId] : [];
    });
  }

  private async stageMedia(
    handoffId: string,
    sources: readonly BrowserCompanionMediaSource[],
  ): Promise<BrowserCompanionMedia[]> {
    if (sources.length === 0) return [];
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
            if (!stats.isFile() || stats.size <= 0 || stats.size > BROWSER_COMPANION_MAX_MEDIA_BYTES) {
              throw new BrowserCompanionStateError('Browser companion media exceeds the per-file size limit');
            }
            byteSize = stats.size;
          } finally {
            await sourceHandle.close();
          }
        } else {
          byteSize = source.bytes.byteLength;
          if (byteSize <= 0 || byteSize > BROWSER_COMPANION_MAX_MEDIA_BYTES) {
            throw new BrowserCompanionStateError('Browser companion media exceeds the per-file size limit');
          }
        }
        totalBytes += byteSize;
        if (totalBytes > BROWSER_COMPANION_MAX_TOTAL_MEDIA_BYTES) {
          throw new BrowserCompanionStateError('Browser companion media exceeds the total size limit');
        }

        const mediaId = randomUUID();
        const fileName = path.basename(source.suggestedName);
        const destination = path.join(directory, `${mediaId}${MEDIA_EXTENSIONS[mimeType]}`);
        if (source.kind === 'file') await copyFile(source.absolutePath, destination, constants.COPYFILE_EXCL);
        else await writeFile(destination, source.bytes, { flag: 'wx', mode: 0o600 });
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
        continue;
      }

      const claimed = browserCompanionClaimedRecordSchema.safeParse(record);
      if (claimed.success && Date.parse(claimed.data.leaseExpiresAt) > now) continue;

      await writeBoundedJson(claimedPath, baseRecord(record), 'w');
      try {
        await rename(claimedPath, this.statePath('ready', handoffId));
      } catch (reason) {
        if (hasErrorCode(reason, 'ENOENT')) continue;
        throw new BrowserCompanionStateError('Browser companion could not recover an interrupted claim');
      }
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
  ): Promise<BrowserCompanionHistoryItem> {
    await this.ensureDirectories();
    const handoffId = randomUUID();
    const media = await this.stageMedia(handoffId, mediaSources);
    const record = browserCompanionRecordBaseSchema.parse({
      schemaVersion: 4,
      handoffId,
      target: input.target,
      source: input.source,
      contentKind: input.contentKind,
      title: input.title ?? null,
      text: input.text,
      media,
      createdAt: new Date().toISOString(),
    });
    try {
      await writeBoundedJson(this.statePath('ready', record.handoffId), record, 'wx');
    } catch (reason) {
      await rm(this.mediaDirectory(handoffId), { recursive: true, force: true });
      throw reason;
    }
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
    const claimed = browserCompanionClaimedRecordSchema.parse({
      ...parsed.data,
      completionToken: randomUUID(),
      claimedAt: claimedAt.toISOString(),
      leaseExpiresAt: new Date(claimedAt.getTime() + CLAIM_LEASE_MS).toISOString(),
    });
    try {
      await writeBoundedJson(claimedPath, claimed, 'w');
    } catch (reason) {
      await writeBoundedJson(claimedPath, parsed.data, 'w').catch(() => undefined);
      await rename(claimedPath, readyPath).catch(() => undefined);
      throw reason;
    }

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
        text: claimed.text,
        media: claimed.media,
        createdAt: claimed.createdAt,
        claimedAt: claimed.claimedAt,
      },
    };
  }

  async claim(target: BrowserCompanionTarget, handoffId?: string): Promise<BrowserCompanionResponse> {
    await this.ensureDirectories();
    await this.recoverInterruptedClaims();

    if (handoffId) {
      const response = await this.claimRecord(handoffId, target);
      return response ?? companionError('HANDOFF_NOT_FOUND');
    }

    const candidates = (await this.recordsForState('ready'))
      .filter((record) => record.target === target)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    for (const candidate of candidates) {
      const response = await this.claimRecord(candidate.handoffId, target);
      if (response) return response;
    }
    return { protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION, ok: true, kind: 'empty' };
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
    await this.ensureDirectories();
    const record = await this.claimedRecord(handoffId, completionToken, target);
    if ('kind' in record) return record;

    const delivered = browserCompanionDeliveredRecordSchema.parse({
      ...baseRecord(record),
      claimedAt: record.claimedAt,
      deliveredAt: new Date().toISOString(),
    });
    const claimedPath = this.statePath('claimed', handoffId);
    await writeBoundedJson(claimedPath, delivered, 'w');
    try {
      await rename(claimedPath, this.statePath('delivered', handoffId));
    } catch (reason) {
      if (!hasErrorCode(reason, 'ENOENT')) throw reason;
      return companionError('HANDOFF_NOT_FOUND');
    }
    return { protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION, ok: true, kind: 'completed', handoffId };
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
    await this.ensureDirectories();
    const record = await this.claimedRecord(handoffId, completionToken, target);
    if ('kind' in record) return record;

    const claimedPath = this.statePath('claimed', handoffId);
    await writeBoundedJson(claimedPath, baseRecord(record), 'w');
    try {
      await rename(claimedPath, this.statePath('ready', handoffId));
    } catch (reason) {
      if (hasErrorCode(reason, 'ENOENT')) return companionError('HANDOFF_NOT_FOUND');
      throw reason;
    }
    return { protocolVersion: BROWSER_COMPANION_PROTOCOL_VERSION, ok: true, kind: 'released', handoffId };
  }

  async listHistory(): Promise<BrowserCompanionHistoryItem[]> {
    await this.ensureDirectories();
    await this.recoverInterruptedClaims();
    const records = await Promise.all(
      STATE_DIRECTORIES.map(async (state) =>
        (await this.recordsForState(state)).map((record) => historyItem(record, state)),
      ),
    );
    return records
      .flat()
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .slice(0, MAX_HISTORY_ITEMS);
  }

  async deleteHistory(handoffIds: readonly string[]): Promise<BrowserCompanionDeleteResult> {
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
      if (!moved) continue;

      await writeBoundedJson(deletedPath, { schemaVersion: 1, handoffId, deletedAt: new Date().toISOString() }, 'w');
      await rm(this.mediaDirectory(handoffId), { recursive: true, force: true });
      deletedHandoffIds.push(handoffId);
    }

    return { deletedHandoffIds };
  }
}
