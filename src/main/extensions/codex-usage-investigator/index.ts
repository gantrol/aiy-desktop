import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type {
  CodexUsageCleanupLevel,
  CodexUsageCleanupResult,
  CodexUsageExportFormat,
  CodexUsageInvestigation,
  CodexUsageScanInput,
  CodexUsageScanProgress,
  CodexUsageState,
  CodexUsageTask,
} from '@/shared/contracts/codex-usage';
import {
  CODEX_USAGE_DEFAULT_QUOTA_SAMPLE_PERCENT,
  codexUsageCleanupResultSchema,
  codexUsageInvestigationSchema,
  codexUsageQuotaSamplePercentSchema,
  codexUsageTaskSchema,
} from '@/shared/contracts/codex-usage';
import { readCodexQuotaPurity } from '@/main/extensions/codex-usage-investigator/quota-purity';
import { codexUsageDateRangeEpochs } from '@/shared/codex-usage-time';
import { CodexUsageCacheDatabase } from '@/main/extensions/codex-usage-investigator/cache-database';
import { serializeCodexUsageExport } from '@/main/extensions/codex-usage-investigator/export';
import { codexUsageRangeStart, scanCodexUsage } from '@/main/extensions/codex-usage-investigator/scanner';

interface InvestigatorOptions {
  dataDirectory: string;
  onTaskChanged(task: CodexUsageTask): void;
}

function initialProgress(): CodexUsageScanProgress {
  return {
    phase: 'DISCOVERING',
    filesDiscovered: 0,
    filesProcessed: 0,
    filesScanned: 0,
    filesCached: 0,
    bytesRead: 0,
    bytesTotal: 0,
    throughputBytesPerSecond: 0,
    estimatedRemainingMs: null,
    calculationPercent: 0,
    elapsedMs: 0,
  };
}

export class CodexUsageInvestigator {
  private cache: Promise<CodexUsageCacheDatabase> | null = null;
  private readonly dataDirectory: string;
  private readonly onTaskChanged: InvestigatorOptions['onTaskChanged'];
  private controller: AbortController | null = null;
  private currentTask: CodexUsageTask | null = null;
  private clearing = false;
  private exporting = false;
  private readonly quotaVariants = new Map<
    string,
    Pick<CodexUsageInvestigation, 'quotaPurity' | 'quotaPurityIssue' | 'quotaCalculatedAt'>
  >();
  private readonly purityReads = new Map<string, Promise<CodexUsageInvestigation>>();

  constructor(options: InvestigatorOptions) {
    this.dataDirectory = options.dataDirectory;
    this.onTaskChanged = options.onTaskChanged;
  }

  get hasPending() {
    return this.controller !== null || this.clearing || this.exporting || this.purityReads.size > 0;
  }

  private getCache() {
    return (this.cache ??= CodexUsageCacheDatabase.open(this.dataDirectory).catch((error) => {
      this.cache = null;
      throw error;
    }));
  }

  async state(beforeInvestigationId?: string): Promise<CodexUsageState> {
    const persisted = (await this.getCache()).state(beforeInvestigationId);
    return this.currentTask ? { ...persisted, task: this.currentTask } : persisted;
  }

  async investigation(investigationId: string, minimumQuotaPercent?: number): Promise<CodexUsageInvestigation> {
    const key = JSON.stringify([investigationId, minimumQuotaPercent ?? null]);
    const pending = this.purityReads.get(key);
    if (pending) return pending;
    const result = this.readInvestigation(investigationId, minimumQuotaPercent).finally(() =>
      this.purityReads.delete(key),
    );
    this.purityReads.set(key, result);
    return result;
  }

  private async readInvestigation(investigationId: string, requestedQuotaPercent?: number) {
    const cache = await this.getCache();
    const investigation = cache.investigation(investigationId);
    if (!investigation) throw new Error('Codex usage investigation was not found');
    const current = investigation.quotaPurity;
    const savedQuotaPercent = codexUsageQuotaSamplePercentSchema.safeParse(current?.minimumQuotaPercent);
    const minimumQuotaPercent =
      requestedQuotaPercent ??
      (savedQuotaPercent.success ? savedQuotaPercent.data : CODEX_USAGE_DEFAULT_QUOTA_SAMPLE_PERCENT);
    // Reading a historical report never upgrades its calculations or reference data.
    if (requestedQuotaPercent === undefined || current?.minimumQuotaPercent === minimumQuotaPercent)
      return investigation;
    if (this.controller || this.clearing) throw new Error('CODEX_USAGE_BUSY');
    const key = JSON.stringify([investigationId, minimumQuotaPercent]);
    const cached = this.quotaVariants.get(key);
    if (cached) return codexUsageInvestigationSchema.parse({ ...investigation, ...cached });
    const quotaPurity = await readCodexQuotaPurity(
      cache,
      investigation.from,
      investigation.to,
      minimumQuotaPercent,
    ).catch(() => null);
    const variant = codexUsageInvestigationSchema.parse({
      ...investigation,
      quotaPurity,
      quotaPurityIssue: quotaPurity ? null : 'READ_FAILED',
      quotaCalculatedAt: new Date().toISOString(),
    });
    if (quotaPurity) {
      if (this.quotaVariants.size >= 8) this.quotaVariants.delete(this.quotaVariants.keys().next().value!);
      this.quotaVariants.set(key, {
        quotaPurity: variant.quotaPurity,
        quotaPurityIssue: variant.quotaPurityIssue,
        quotaCalculatedAt: variant.quotaCalculatedAt,
      });
    }
    return variant;
  }

  async start(input: CodexUsageScanInput) {
    const cache = await this.getCache();
    if (this.hasPending) throw new Error('A Codex usage investigation is already running');
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const source = input.sourceInvestigationId ? cache.investigation(input.sourceInvestigationId) : null;
    if (input.sourceInvestigationId && !source) throw new Error('Codex usage investigation was not found');
    const scope = source ?? input;
    const epochs = source
      ? { fromEpoch: source.from ? Date.parse(source.from) : null, toEpoch: Date.parse(source.to) }
      : input.range === 'CUSTOM' && input.dateRange
        ? codexUsageDateRangeEpochs(input.dateRange, input.timeZone, now)
        : { fromEpoch: codexUsageRangeStart(input.range, now, input.timeZone), toEpoch: now };
    cache.cancelPendingTasks();
    const task = codexUsageTaskSchema.parse({
      taskId: randomUUID(),
      range: scope.range,
      dateRange: scope.dateRange,
      timeZone: scope.timeZone,
      granularity: scope.granularity,
      detailedStatistics: input.detailedStatistics,
      status: 'RUNNING',
      createdAt: timestamp,
      startedAt: timestamp,
      updatedAt: timestamp,
      fromEpoch: epochs.fromEpoch,
      toEpoch: epochs.toEpoch,
      progress: initialProgress(),
      investigationId: null,
      errorMessage: null,
    });
    cache.createTask(task);
    return this.launch(task, cache);
  }

  async resume(taskId: string) {
    const cache = await this.getCache();
    if (this.hasPending) throw new Error('A Codex usage investigation is already running');
    const persisted = cache.task(taskId);
    if (!persisted || !['PAUSED', 'INTERRUPTED'].includes(persisted.status)) {
      throw new Error('Codex usage investigation cannot be resumed');
    }
    return this.launch(
      codexUsageTaskSchema.parse({
        ...persisted,
        status: 'RUNNING',
        updatedAt: new Date().toISOString(),
        errorMessage: null,
      }),
      cache,
    );
  }

  async resumeLatest() {
    const task = (await this.getCache()).latestResumableTask();
    return task ? this.resume(task.taskId) : null;
  }

  pause() {
    this.controller?.abort();
  }

  async cleanup(level: CodexUsageCleanupLevel): Promise<CodexUsageCleanupResult> {
    const cache = await this.getCache();
    if (this.hasPending) throw new Error('A running Codex usage investigation cannot be cleared');
    this.clearing = true;
    try {
      if (level === 'LOCAL_INDEX') await cache.backupFacts();
      const removed = cache.cleanup(level);
      this.quotaVariants.clear();
      const state = cache.state();
      this.currentTask = state.task;
      return codexUsageCleanupResultSchema.parse({ level, removed, state });
    } finally {
      this.clearing = false;
    }
  }

  async export(
    investigationId: string,
    format: CodexUsageExportFormat,
    destinationPath: string,
    minimumQuotaPercent?: number,
  ) {
    if (this.clearing || this.exporting) throw new Error('CODEX_USAGE_BUSY');
    this.exporting = true;
    try {
      const cache = await this.getCache();
      const investigation = await this.investigation(investigationId, minimumQuotaPercent);
      const rows = cache.exportRows(investigationId);
      if (!rows) throw new Error('Codex usage investigation was not found');
      await writeFile(destinationPath, serializeCodexUsageExport(investigation, rows, format), { encoding: 'utf8' });
    } finally {
      this.exporting = false;
    }
  }

  private launch(task: CodexUsageTask, cache: CodexUsageCacheDatabase) {
    const controller = new AbortController();
    this.controller = controller;
    this.currentTask = task;
    cache.saveTask(task);
    this.emit(task);
    void this.execute(task, controller, cache);
    return task;
  }

  private async execute(task: CodexUsageTask, controller: AbortController, cache: CodexUsageCacheDatabase) {
    try {
      const scanned = await scanCodexUsage({
        investigationId: task.taskId,
        range: task.range,
        dateRange: task.dateRange,
        timeZone: task.timeZone,
        granularity: task.granularity,
        detailedStatistics: task.detailedStatistics,
        fromEpoch: task.fromEpoch,
        toEpoch: task.toEpoch,
        cache,
        signal: controller.signal,
        onProgress: (progress) => this.updateProgress(task.taskId, progress, false, cache),
        onCheckpoint: (progress) => this.updateProgress(task.taskId, progress, true, cache),
      });
      controller.signal.throwIfAborted();
      const investigation = codexUsageInvestigationSchema.parse(scanned.investigation);
      const completed = codexUsageTaskSchema.parse({
        ...(this.currentTask?.taskId === task.taskId ? this.currentTask : task),
        status: 'COMPLETED',
        updatedAt: new Date().toISOString(),
        investigationId: investigation.investigationId,
        errorMessage: null,
      });
      cache.completeTask(completed, investigation, scanned.exportRows);
      this.currentTask = completed;
      this.emit(completed);
    } catch (error) {
      const aborted = (error as Error).name === 'AbortError';
      const current = this.currentTask?.taskId === task.taskId ? this.currentTask : task;
      const terminal = codexUsageTaskSchema.parse({
        ...current,
        status: aborted ? 'PAUSED' : 'FAILED',
        updatedAt: new Date().toISOString(),
        errorMessage: aborted ? null : String((error as Error).message || error).slice(0, 2_000),
      });
      this.currentTask = terminal;
      cache.saveTask(terminal);
      this.emit(terminal);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  private updateProgress(
    taskId: string,
    progress: CodexUsageScanProgress,
    checkpoint: boolean,
    cache: CodexUsageCacheDatabase,
  ) {
    if (this.currentTask?.taskId !== taskId) return;
    const updated = codexUsageTaskSchema.parse({
      ...this.currentTask,
      progress,
      updatedAt: new Date().toISOString(),
    });
    this.currentTask = updated;
    if (checkpoint) cache.saveTask(updated);
    else this.emit(updated);
  }

  private emit(task: CodexUsageTask) {
    this.onTaskChanged(codexUsageTaskSchema.parse(task));
  }
}
