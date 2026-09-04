import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import type {
  CodexHistoryFilterOptionsInput,
  CodexHistoryIndexState,
  CodexHistoryRefreshInput,
  CodexHistorySearchInput,
  CodexHistoryThreadMessagesInput,
} from '@/shared/contracts/codex-history-search';
import {
  CodexHistorySearchCacheDatabase,
  CodexHistoryThreadSnapshotRequiredError,
} from '@/main/extensions/codex-history-search/cache-database';
import {
  discoverCodexHistorySources,
  readCodexHistorySourceSnapshot,
} from '@/main/extensions/codex-history-search/source-reader';
import { readCodexHistoryThreadMessages } from '@/main/extensions/codex-history-search/thread-reader';

const SOURCE_REFRESH_INTERVAL_MS = 30_000;

function pathContainsForbiddenSegment(candidatePath: string) {
  return path
    .resolve(candidatePath)
    .split(path.sep)
    .some((segment) => segment.toLowerCase().includes('trash'));
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

export class CodexHistorySearch extends EventEmitter {
  readonly codexHome: string;
  private active = false;
  private databasePromise: Promise<CodexHistorySearchCacheDatabase> | null = null;
  private refreshPromise: Promise<CodexHistoryIndexState> | null = null;
  private queuedRebuildPromise: Promise<CodexHistoryIndexState> | null = null;
  private refreshController: AbortController | null = null;
  private threadMessagesController: AbortController | null = null;
  private progress = 0;
  private lastError: string | null = null;
  private sourceUnavailable = false;
  private lastRefreshAttemptAt = 0;

  constructor(
    private readonly dataDirectory: string,
    codexHome?: string,
  ) {
    super();
    const configuredHome = codexHome ?? process.env.CODEX_HOME?.trim();
    this.codexHome = path.resolve(configuredHome || path.join(os.homedir(), '.codex'));
  }

  get hasPending() {
    return this.refreshPromise !== null;
  }

  setActive(active: boolean) {
    this.active = active;
    if (!active) {
      this.refreshController?.abort();
      this.threadMessagesController?.abort();
    }
  }

  async state() {
    this.assertActive();
    const database = await this.database();
    this.scheduleRefresh();
    return this.indexState(database);
  }

  async search(input: CodexHistorySearchInput) {
    this.assertActive();
    const database = await this.database();
    this.scheduleRefresh();
    return database.search(input, this.indexState(database));
  }

  async filterOptions(input: CodexHistoryFilterOptionsInput) {
    this.assertActive();
    const database = await this.database();
    this.scheduleRefresh();
    return database.filterOptions(input);
  }

  async threadMessages(input: CodexHistoryThreadMessagesInput) {
    this.assertActive();
    this.threadMessagesController?.abort();
    const controller = new AbortController();
    this.threadMessagesController = controller;
    try {
      const sources = await discoverCodexHistorySources(this.codexHome);
      controller.signal.throwIfAborted();
      if (!sources) throw new Error('Codex task databases were not found');
      return await readCodexHistoryThreadMessages(sources, this.codexHome, input, controller.signal);
    } finally {
      if (this.threadMessagesController === controller) this.threadMessagesController = null;
    }
  }

  async refresh(input: CodexHistoryRefreshInput) {
    this.assertActive();
    await this.startRefresh(input.rebuild);
    return this.indexState(await this.database());
  }

  async purge() {
    this.refreshController?.abort();
    this.threadMessagesController?.abort();
    await this.refreshPromise?.catch(() => undefined);
    const database = await this.database();
    database.purge();
    this.progress = 0;
    this.lastError = null;
    this.sourceUnavailable = false;
    this.emit('changed');
  }

  async dispose() {
    this.active = false;
    this.refreshController?.abort();
    this.threadMessagesController?.abort();
    await this.refreshPromise?.catch(() => undefined);
    const pendingDatabase = this.databasePromise;
    this.databasePromise = null;
    if (pendingDatabase) (await pendingDatabase).close();
    this.removeAllListeners();
  }

  private assertActive() {
    if (!this.active) throw new Error('Codex History Search is disabled or missing permissions');
  }

  private database() {
    if (pathContainsForbiddenSegment(this.dataDirectory)) {
      throw new Error('Codex history index storage path is unavailable');
    }
    this.databasePromise ??= CodexHistorySearchCacheDatabase.create(this.dataDirectory).catch((reason) => {
      this.databasePromise = null;
      throw reason;
    });
    return this.databasePromise;
  }

  private indexState(database: CodexHistorySearchCacheDatabase): CodexHistoryIndexState {
    const meta = database.meta();
    if (this.refreshPromise) {
      return {
        status: 'INDEXING',
        progress: this.progress,
        indexedThreads: meta.indexedThreads,
        indexedMessages: meta.indexedMessages,
        updatedAt: meta.indexedAt,
        message: this.lastError,
      };
    }
    if (meta.indexedAt) {
      return {
        status: 'READY',
        progress: 100,
        indexedThreads: meta.indexedThreads,
        indexedMessages: meta.indexedMessages,
        updatedAt: meta.indexedAt,
        message: this.sourceUnavailable
          ? 'Codex source is unavailable; showing the latest local index'
          : this.lastError,
      };
    }
    return {
      status: this.sourceUnavailable ? 'UNAVAILABLE' : this.lastError ? 'ERROR' : 'EMPTY',
      progress: this.progress,
      indexedThreads: 0,
      indexedMessages: 0,
      updatedAt: null,
      message: this.lastError,
    };
  }

  private scheduleRefresh() {
    if (!this.active || this.refreshPromise) return;
    if (Date.now() - this.lastRefreshAttemptAt < SOURCE_REFRESH_INTERVAL_MS) return;
    void this.startRefresh(false).catch((reason) => {
      if ((reason as { name?: string } | null)?.name !== 'AbortError') {
        console.warn('[codex-history-search] background refresh failed', errorMessage(reason));
      }
    });
  }

  private startRefresh(rebuild: boolean): Promise<CodexHistoryIndexState> {
    if (this.refreshPromise) {
      if (!rebuild) return this.refreshPromise;
      if (this.queuedRebuildPromise) return this.queuedRebuildPromise;
      const pending = this.refreshPromise;
      this.refreshController?.abort();
      const queued = pending
        .then(() => {
          this.assertActive();
          return this.startRefresh(true);
        })
        .finally(() => {
          this.queuedRebuildPromise = null;
        });
      this.queuedRebuildPromise = queued;
      return this.queuedRebuildPromise;
    }
    const controller = new AbortController();
    this.refreshController = controller;
    this.progress = 1;
    this.lastError = null;
    this.sourceUnavailable = false;
    this.lastRefreshAttemptAt = Date.now();
    const operation = this.performRefresh(rebuild, controller.signal)
      .catch(async (reason): Promise<CodexHistoryIndexState> => {
        if ((reason as { name?: string } | null)?.name === 'AbortError') {
          const database = await this.database();
          return this.indexState(database);
        }
        this.lastError = errorMessage(reason).slice(0, 2_000);
        const database = await this.database();
        return this.indexState(database);
      })
      .finally(() => {
        if (this.refreshController === controller) this.refreshController = null;
        if (this.refreshPromise === operation) this.refreshPromise = null;
        this.emit('changed');
      });
    this.refreshPromise = operation;
    this.emit('changed');
    return operation;
  }

  private async performRefresh(rebuild: boolean, signal: AbortSignal): Promise<CodexHistoryIndexState> {
    const database = await this.database();
    signal.throwIfAborted();
    const sources = await discoverCodexHistorySources(this.codexHome);
    signal.throwIfAborted();
    if (!sources) {
      this.sourceUnavailable = true;
      this.lastError = 'Codex task databases were not found';
      return this.indexState(database);
    }
    const meta = database.meta();
    if (!rebuild && meta.sourceSignature === sources.signature && meta.indexedAt) {
      this.progress = 100;
      return this.indexState(database);
    }
    const rebuildMessages = rebuild || !meta.indexedAt || meta.sourceHistoryId !== sources.historySourceId;
    const rebuildThreads = rebuild || !meta.indexedAt || meta.sourceStateId !== sources.stateSourceId;
    const cursor = {
      historyRowId: rebuildMessages ? 0 : meta.sourceHistoryRowId,
      threadUpdatedAtMs: rebuildThreads ? 0 : meta.sourceThreadUpdatedAtMs,
      threadCount: rebuildThreads ? 0 : meta.sourceThreadCount,
      projectSignature: rebuildThreads ? null : meta.sourceProjectSignature,
      fullThreads: rebuildThreads,
    };
    const reportProgress = (progress: number) => {
      this.progress = progress;
      this.emit('changed');
    };
    let snapshot = await readCodexHistorySourceSnapshot(sources, cursor, signal, reportProgress);
    signal.throwIfAborted();
    this.progress = 85;
    this.emit('changed');
    await new Promise<void>((resolve) => setImmediate(resolve));
    try {
      database.apply(snapshot, rebuildMessages || snapshot.sourceReset);
    } catch (reason) {
      if (!(reason instanceof CodexHistoryThreadSnapshotRequiredError) || snapshot.fullThreadSnapshot) throw reason;
      snapshot = await readCodexHistorySourceSnapshot(sources, { ...cursor, fullThreads: true }, signal, (progress) =>
        reportProgress(85 + Math.round(progress * 0.1)),
      );
      signal.throwIfAborted();
      database.apply(snapshot, rebuildMessages || snapshot.sourceReset);
    }
    this.progress = 100;
    this.lastError = null;
    this.sourceUnavailable = false;
    return this.indexState(database);
  }
}
