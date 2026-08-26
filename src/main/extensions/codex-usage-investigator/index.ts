import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type {
  CodexUsageCleanupLevel,
  CodexUsageCleanupResult,
  CodexUsageExportFormat,
  CodexUsageInvestigation,
  CodexUsageQuotaSnapshot,
  CodexUsageScanInput,
  CodexUsageScanProgress,
  CodexUsageState,
  CodexUsageTask,
} from '@/shared/contracts/codex-usage';
import {
  codexUsageCleanupResultSchema,
  codexUsageInvestigationSchema,
  codexUsageTaskSchema,
} from '@/shared/contracts/codex-usage';
import { CodexUsageCacheDatabase } from '@/main/extensions/codex-usage-investigator/cache-database';
import { serializeCodexUsageExport } from '@/main/extensions/codex-usage-investigator/export';
import { codexUsageRangeStart, scanCodexUsage } from '@/main/extensions/codex-usage-investigator/scanner';

interface RunOptions {
  quotaPermissionGranted: boolean;
  readQuota?: (signal: AbortSignal) => Promise<CodexUsageQuotaSnapshot>;
}

interface InvestigatorOptions {
  dataDirectory: string;
  onTaskChanged(task: CodexUsageTask): void;
}

type QuotaResult =
  | { state: 'LIVE'; quota: CodexUsageQuotaSnapshot; message: null }
  | { state: 'PERMISSION_REQUIRED' | 'CODEX_UNAVAILABLE' | 'UNAVAILABLE'; quota: null; message: string };

async function resolveQuota(options: RunOptions, signal: AbortSignal): Promise<QuotaResult> {
  if (!options.quotaPermissionGranted) {
    return { state: 'PERMISSION_REQUIRED', quota: null, message: 'Optional Codex quota permission is not granted' };
  }
  if (!options.readQuota) {
    return { state: 'CODEX_UNAVAILABLE', quota: null, message: 'Codex quota service is unavailable' };
  }
  try {
    return { state: 'LIVE', quota: await options.readQuota(signal), message: null };
  } catch {
    return { state: 'UNAVAILABLE', quota: null, message: 'Codex quota could not be read' };
  }
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
    elapsedMs: 0,
  };
}

export class CodexUsageInvestigator {
  private readonly cache: CodexUsageCacheDatabase;
  private readonly onTaskChanged: InvestigatorOptions['onTaskChanged'];
  private controller: AbortController | null = null;
  private currentTask: CodexUsageTask | null = null;

  constructor(options: InvestigatorOptions) {
    this.cache = new CodexUsageCacheDatabase(options.dataDirectory);
    this.onTaskChanged = options.onTaskChanged;
  }

  get hasPending() {
    return this.controller !== null;
  }

  state(): CodexUsageState {
    const persisted = this.cache.state();
    return this.currentTask ? { ...persisted, task: this.currentTask } : persisted;
  }

  investigation(investigationId: string) {
    const investigation = this.cache.investigation(investigationId);
    if (!investigation) throw new Error('Codex usage investigation was not found');
    return investigation;
  }

  start(input: CodexUsageScanInput, options: RunOptions) {
    if (this.controller) throw new Error('A Codex usage investigation is already running');
    this.cache.cancelPendingTasks();
    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const task = codexUsageTaskSchema.parse({
      taskId: randomUUID(),
      range: input.range,
      timeZone: input.timeZone,
      granularity: input.granularity,
      status: 'RUNNING',
      createdAt: timestamp,
      startedAt: timestamp,
      updatedAt: timestamp,
      fromEpoch: codexUsageRangeStart(input.range, now, input.timeZone),
      toEpoch: now,
      progress: initialProgress(),
      investigationId: null,
      errorMessage: null,
    });
    this.cache.createTask(task);
    return this.launch(task, options);
  }

  resume(taskId: string, options: RunOptions) {
    if (this.controller) throw new Error('A Codex usage investigation is already running');
    const persisted = this.cache.task(taskId);
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
      options,
    );
  }

  resumeLatest(options: RunOptions) {
    const task = this.cache.latestResumableTask();
    return task ? this.resume(task.taskId, options) : null;
  }

  pause() {
    this.controller?.abort();
  }

  cleanup(level: CodexUsageCleanupLevel): CodexUsageCleanupResult {
    if (this.controller) throw new Error('A running Codex usage investigation cannot be cleared');
    const removed = this.cache.cleanup(level);
    const state = this.cache.state();
    this.currentTask = state.task;
    return codexUsageCleanupResultSchema.parse({ level, removed, state });
  }

  async export(investigationId: string, format: CodexUsageExportFormat, destinationPath: string) {
    const investigation = this.cache.investigation(investigationId);
    const rows = this.cache.exportRows(investigationId);
    if (!investigation || !rows) throw new Error('Codex usage investigation was not found');
    const contents = serializeCodexUsageExport(investigation, rows, format);
    await writeFile(destinationPath, contents, { encoding: 'utf8' });
  }

  private launch(task: CodexUsageTask, options: RunOptions) {
    const controller = new AbortController();
    this.controller = controller;
    this.currentTask = task;
    this.cache.saveTask(task);
    this.emit(task);
    void this.execute(task, options, controller);
    return task;
  }

  private async execute(task: CodexUsageTask, options: RunOptions, controller: AbortController) {
    const quotaPromise = resolveQuota(options, controller.signal);
    try {
      const scanned = await scanCodexUsage({
        investigationId: task.taskId,
        range: task.range,
        timeZone: task.timeZone,
        granularity: task.granularity,
        fromEpoch: task.fromEpoch,
        toEpoch: task.toEpoch,
        cache: this.cache,
        signal: controller.signal,
        onProgress: (progress) => this.updateProgress(task.taskId, progress, false),
        onCheckpoint: (progress) => this.updateProgress(task.taskId, progress, true),
      });
      const quota = await quotaPromise;
      const warnings = new Set(scanned.investigation.warnings);
      if (quota.state !== 'LIVE') warnings.add('QUOTA_UNAVAILABLE');
      const investigation: CodexUsageInvestigation = codexUsageInvestigationSchema.parse({
        ...scanned.investigation,
        quotaState: quota.state,
        quotaMessage: quota.message,
        quota: quota.quota,
        warnings: [...warnings],
      });
      const completed = codexUsageTaskSchema.parse({
        ...(this.currentTask?.taskId === task.taskId ? this.currentTask : task),
        status: 'COMPLETED',
        updatedAt: new Date().toISOString(),
        investigationId: investigation.investigationId,
        errorMessage: null,
      });
      this.cache.completeTask(completed, investigation, scanned.exportRows);
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
      this.cache.saveTask(terminal);
      this.emit(terminal);
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }

  private updateProgress(taskId: string, progress: CodexUsageScanProgress, checkpoint: boolean) {
    if (this.currentTask?.taskId !== taskId) return;
    const updated = codexUsageTaskSchema.parse({
      ...this.currentTask,
      progress,
      updatedAt: new Date().toISOString(),
    });
    this.currentTask = updated;
    if (checkpoint) this.cache.saveTask(updated);
    else this.emit(updated);
  }

  private emit(task: CodexUsageTask) {
    this.onTaskChanged(codexUsageTaskSchema.parse(task));
  }
}
