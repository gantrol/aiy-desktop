import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import type { CodexHealth, CodexTextModelDto, GenerationInput } from '@/shared/contracts';
import {
  type CodexAdapterLifecycleOptions,
  type CodexThreadContext,
  type ProcessRunner,
  type TempJobRemover,
  SAFE_JOB_ID,
  codexCancelledError,
  exactTempJob,
  pinnedImageCodexBinary,
  removeExactTempJob,
  reportCleanupFailure,
  runProcess,
  safeTempParent,
  sameRealPath,
  throwIfCodexCancelled,
} from '@/main/assistant/codex-runtime';
import { LibraryDatabase } from '@/main/database';
import type { ExtensionThreadScopeKind } from '@/main/database/extensions/extension-repository';
import { CodexAppServerClient, CodexAppServerRpcError } from '@/main/extensions/codex-app-server/client';
import { CODEX_APP_SERVER_EXTENSION_ID } from '@/shared/extension-ids';
import { validatePngFile } from '@/main/media/png-validation';

export class CodexAdapterCore {
  protected health: CodexHealth = {
    state: 'checking',
    version: '',
    authenticated: false,
    message: 'Checking local Codex',
  };

  protected activeStatelessJobs = 0;

  protected readonly activeStatelessProcesses = new Set<ChildProcessWithoutNullStreams>();

  protected readonly activeAppServerCancels = new Set<() => void>();

  protected readonly pendingListeners = new Set<(activeCount: number) => void>();

  protected readonly appServer: CodexAppServerClient;

  protected readonly threadTails = new Map<string, Promise<unknown>>();

  protected readonly transport: 'app-server' | 'exec';

  protected readonly imageBinary: string | null;

  protected readonly isExtensionActivated: () => boolean;

  constructor(
    protected readonly database: LibraryDatabase,
    protected readonly libraryRoot: string,
    protected readonly binary = process.env.CODEX_BINARY || 'codex',
    protected readonly processRunner: ProcessRunner = runProcess,
    protected readonly tempJobRemover: TempJobRemover = removeExactTempJob,
    lifecycle: CodexAdapterLifecycleOptions = {},
  ) {
    this.transport = lifecycle.transport ?? (processRunner === runProcess ? 'app-server' : 'exec');
    this.imageBinary =
      lifecycle.imageBinary === undefined
        ? processRunner === runProcess
          ? pinnedImageCodexBinary()
          : null
        : lifecycle.imageBinary;
    this.isExtensionActivated = lifecycle.isExtensionActivated ?? (() => true);
    this.appServer = new CodexAppServerClient(this.binary, path.resolve(this.libraryRoot));
    if (lifecycle.manageGenerationJobs !== false) {
      this.recoverInterruptedGenerationJobs();
      this.cleanupTerminalGenerationJobs();
      this.cleanupSupersededInterruptedGenerationJobs();
    }
    if (lifecycle.manageStatelessJobs !== false) {
      this.cleanupAbandonedStatelessJobs('assist');
      this.cleanupAbandonedStatelessJobs('title');
    }
  }

  get cachedHealth() {
    return this.health;
  }

  get hasPending() {
    return this.activeStatelessJobs > 0;
  }

  get pendingCount() {
    return this.activeStatelessJobs;
  }

  onPendingChanged(listener: (activeCount: number) => void) {
    this.pendingListeners.add(listener);
    return () => {
      this.pendingListeners.delete(listener);
    };
  }

  cancelStatelessJobs() {
    for (const child of this.activeStatelessProcesses) child.kill();
    for (const cancel of this.activeAppServerCancels) cancel();
  }

  async dispose() {
    this.cancelStatelessJobs();
    await this.appServer.dispose();
  }

  async refreshHealth(signal?: AbortSignal): Promise<CodexHealth> {
    throwIfCodexCancelled(signal);
    if (!this.isExtensionActivated()) {
      this.health = {
        state: 'unavailable',
        version: '',
        authenticated: false,
        message: 'Codex App Server extension is disabled or missing permissions',
      };
      return this.health;
    }
    try {
      const cwd = path.resolve(this.libraryRoot);
      const [version, auth] = await Promise.all([
        this.processRunner(this.binary, ['--version'], '', cwd, 10_000, undefined, signal),
        this.processRunner(this.binary, ['login', 'status'], '', cwd, 15_000, undefined, signal),
      ]);
      throwIfCodexCancelled(signal);
      const authenticated = /logged in/i.test(`${auth.stdout}\n${auth.stderr}`);
      this.health = {
        state: authenticated ? 'ready' : 'unavailable',
        version: version.stdout,
        authenticated,
        message: authenticated ? 'Local Codex ready' : 'Codex is not signed in',
      };
    } catch (error) {
      if (signal?.aborted) throw codexCancelledError();
      this.health = {
        state: 'unavailable',
        version: '',
        authenticated: false,
        message: error instanceof Error ? error.message : 'Local Codex unavailable',
      };
    }
    return this.health;
  }

  async listModels(signal?: AbortSignal): Promise<CodexTextModelDto[]> {
    throwIfCodexCancelled(signal);
    if (!this.health.authenticated) await this.refreshHealth(signal);
    if (!this.health.authenticated) throw new Error(this.health.message);
    const models = await this.appServer.listModels();
    throwIfCodexCancelled(signal);
    return models;
  }

  protected async getOrCreateThread(
    context: CodexThreadContext,
    cwd: string,
    developerInstructions: string,
    webSearchMode?: 'disabled' | 'live',
  ) {
    const scopeKind = context.scope.kind as ExtensionThreadScopeKind;
    const binding = this.database.getExtensionThreadBinding(CODEX_APP_SERVER_EXTENSION_ID, scopeKind, context.scope.id);
    if (binding) {
      try {
        await this.appServer.resumeThread(binding.threadId, cwd, webSearchMode);
        return binding.threadId;
      } catch (error) {
        if (!this.isMissingThread(error)) throw error;
      }
    }
    const started = await this.appServer.startThread({ cwd, developerInstructions, webSearchMode });
    const name = this.threadName(context);
    this.database.bindExtensionThread({
      extensionId: CODEX_APP_SERVER_EXTENSION_ID,
      scopeKind,
      scopeId: context.scope.id,
      threadId: started.thread.id,
      threadName: name,
    });
    await this.appServer.setThreadName(started.thread.id, name).catch(() => undefined);
    return started.thread.id;
  }

  protected async forkOperationThread(
    parentThreadId: string,
    operationScopeId: string,
    title: string,
    cwd: string,
    developerInstructions: string,
    webSearchMode: 'disabled' | 'live',
  ) {
    let threadId: string;
    try {
      threadId = (await this.appServer.forkThread(parentThreadId, { cwd, developerInstructions, webSearchMode })).thread
        .id;
    } catch (error) {
      if (!this.isRecoverableForkFailure(error)) throw error;
      threadId = (await this.appServer.startThread({ cwd, developerInstructions, webSearchMode })).thread.id;
    }
    const context: CodexThreadContext = { scope: { kind: 'SYSTEM', id: operationScopeId }, title };
    const name = this.threadName(context);
    this.database.bindExtensionThread({
      extensionId: CODEX_APP_SERVER_EXTENSION_ID,
      scopeKind: 'SYSTEM',
      scopeId: operationScopeId,
      threadId,
      threadName: name,
    });
    await this.appServer.setThreadName(threadId, name).catch(() => undefined);
    return threadId;
  }

  protected threadName(context: CodexThreadContext) {
    const sessionKind =
      context.scope.kind === 'SYSTEM' && context.scope.id.startsWith('session:')
        ? context.scope.id.split(':')[1]
        : context.scope.kind;
    const kind = sessionKind === 'SERIES' ? '创作' : sessionKind === 'DRAFT' ? '草稿' : '系统';
    return `AIY · ${kind} · ${context.title}`.replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  protected generationThreadName(runId: string, input: GenerationInput, fallbackTitle: string) {
    const slotId = this.database.styleExplorationSlotIdForRun(runId);
    const slot = slotId ? this.database.getStyleExplorationSlot(slotId) : null;
    const kind = slot ? '方向实验' : input.sourceAssetId ? '编辑' : '生图';
    const title = slot?.label.trim() || input.title.trim() || fallbackTitle;
    return `AIY · ${kind} · ${title} · ${runId.slice(0, 8)}`.replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  protected sessionRootContext(context: CodexThreadContext): CodexThreadContext {
    return {
      scope: { kind: 'SYSTEM', id: `session:${context.scope.kind}:${context.scope.id}` },
      title: context.title,
    };
  }

  protected serializeThread<T>(context: CodexThreadContext, task: () => Promise<T>): Promise<T> {
    const key = `${context.scope.kind}:${context.scope.id}`;
    const previous = this.threadTails.get(key) ?? Promise.resolve();
    const current = previous.then(task, task);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.threadTails.set(key, tail);
    void tail.finally(() => {
      if (this.threadTails.get(key) === tail) this.threadTails.delete(key);
    });
    return current;
  }

  protected isMissingThread(error: unknown) {
    return (
      error instanceof CodexAppServerRpcError &&
      /not found|does not exist|unknown thread|failed to (?:load|read)/i.test(error.message)
    );
  }

  protected isRecoverableForkFailure(error: unknown) {
    if (!(error instanceof Error)) return false;
    if (/^Codex App Server request timed out: thread\/fork$/i.test(error.message)) return true;
    return (
      error instanceof CodexAppServerRpcError &&
      /not found|not loaded|in progress|active turn|cannot fork/i.test(error.message)
    );
  }

  protected cleanupTerminalGenerationJobs() {
    if (typeof this.database.listGenerationRunIdsForTempCleanup !== 'function') return;
    for (const runId of this.database.listGenerationRunIdsForTempCleanup()) {
      try {
        this.tempJobRemover(this.libraryRoot, 'generation', runId);
      } catch (error) {
        reportCleanupFailure(error, 'generation');
      }
    }
  }

  /**
   * A retry supersedes its interrupted source. Remove that source's temporary
   * directory only when it contains no complete output that could still be
   * recovered manually. Unknown directories and active recoverable runs stay.
   */
  private cleanupSupersededInterruptedGenerationJobs() {
    if (
      typeof this.database.listRecoverableGenerationRuns !== 'function' ||
      typeof this.database.getGenerationJob !== 'function'
    )
      return;
    let parent: string;
    let recoverableRunIds: Set<string>;
    try {
      const safeParent = safeTempParent(this.libraryRoot, 'generation', false);
      if (!safeParent) return;
      parent = safeParent.parent;
      recoverableRunIds = new Set(this.database.listRecoverableGenerationRuns().map(({ runId }) => runId));
    } catch (error) {
      reportCleanupFailure(error, 'generation');
      return;
    }
    let runIds: string[];
    try {
      runIds = readdirSync(parent);
    } catch (error) {
      reportCleanupFailure(error, 'generation');
      return;
    }
    for (const runId of runIds) {
      if (!SAFE_JOB_ID.test(runId) || recoverableRunIds.has(runId)) continue;
      try {
        const state = this.database.getGenerationJob(runId);
        if (state?.status !== 'INTERRUPTED' || state.desiredState !== 'RUN') continue;
        const outputPath = this.safeGenerationOutputPath(runId);
        if (outputPath && validatePngFile(outputPath)) continue;
        this.tempJobRemover(this.libraryRoot, 'generation', runId);
      } catch (error) {
        reportCleanupFailure(error, 'generation');
      }
    }
  }

  /**
   * A process can exit after Codex has written result.png but before the run is
   * committed. Recover that durable output before terminal-temp cleanup runs.
   * Partial or unsafe files are deliberately left untouched for diagnosis.
   */
  private recoverInterruptedGenerationJobs() {
    if (typeof this.database.listRecoverableGenerationRuns !== 'function') return;
    for (const { runId } of this.database.listRecoverableGenerationRuns()) {
      try {
        const realOutputPath = this.safeGenerationOutputPath(runId);
        if (!realOutputPath || !validatePngFile(realOutputPath)) continue;
        this.database.markGenerationPhase(runId, 'RECOVERING', 1);
        try {
          this.database.finishGeneration(runId, realOutputPath);
        } catch (error) {
          this.database.markRun(runId, 'INTERRUPTED', undefined, 'RECOVERY_COMMIT_FAILED');
          throw error;
        }
      } catch (error) {
        console.error('[generation-recovery]', {
          code: error instanceof Error && 'code' in error ? error.code : 'RECOVERY_FAILED',
          runId,
        });
      }
    }
  }

  protected safeGenerationOutputPath(runId: string) {
    const safeParent = safeTempParent(this.libraryRoot, 'generation', false);
    if (!safeParent) return null;
    const { parent, jobDir } = exactTempJob(this.libraryRoot, 'generation', runId);
    if (!sameRealPath(parent, safeParent.parent) || !existsSync(jobDir)) return null;
    const jobStats = lstatSync(jobDir);
    if (!jobStats.isDirectory() || jobStats.isSymbolicLink()) return null;
    const realJobDir = realpathSync(jobDir);
    if (!sameRealPath(path.dirname(realJobDir), safeParent.realParent)) return null;
    const outputPath = path.join(jobDir, 'result.png');
    if (!existsSync(outputPath)) return null;
    const outputStats = lstatSync(outputPath);
    if (!outputStats.isFile() || outputStats.isSymbolicLink()) return null;
    const realOutputPath = realpathSync(outputPath);
    return sameRealPath(path.dirname(realOutputPath), realJobDir) ? realOutputPath : null;
  }

  protected changeActiveStatelessJobs(delta: 1 | -1) {
    this.activeStatelessJobs = Math.max(0, this.activeStatelessJobs + delta);
    for (const listener of this.pendingListeners) {
      try {
        listener(this.activeStatelessJobs);
      } catch {
        // Observers must not affect the Codex task they report.
      }
    }
  }

  protected async runTrackedStatelessProcess(
    command: string,
    args: string[],
    input: string,
    cwd: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) {
    let child: ChildProcessWithoutNullStreams | null = null;
    try {
      return await this.processRunner(
        command,
        args,
        input,
        cwd,
        timeoutMs,
        (spawned) => {
          child = spawned;
          this.activeStatelessProcesses.add(spawned);
        },
        signal,
      );
    } finally {
      if (child) this.activeStatelessProcesses.delete(child);
    }
  }

  protected cleanupAbandonedStatelessJobs(scope: 'assist' | 'title') {
    let parent: string;
    try {
      const safeParent = safeTempParent(this.libraryRoot, scope, false);
      if (!safeParent) return;
      parent = safeParent.parent;
    } catch (error) {
      reportCleanupFailure(error, scope);
      return;
    }
    let entries: string[];
    try {
      entries = readdirSync(parent);
    } catch (error) {
      reportCleanupFailure(error, scope);
      return;
    }
    for (const jobId of entries) {
      if (!SAFE_JOB_ID.test(jobId)) continue;
      try {
        const job = exactTempJob(this.libraryRoot, scope, jobId);
        if (job.parent !== parent || path.dirname(job.jobDir) !== parent) continue;
        this.tempJobRemover(this.libraryRoot, scope, jobId);
      } catch (error) {
        reportCleanupFailure(error, scope);
      }
    }
  }
}
