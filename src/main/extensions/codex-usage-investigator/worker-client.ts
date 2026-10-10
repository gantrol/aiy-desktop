import path from 'node:path';
import { access } from 'node:fs/promises';
import { IsolatedExtensionProcess } from '@/main/extensions/isolated-process';
import type { CodexUsageInvestigator } from '@/main/extensions/codex-usage-investigator';
import { codexUsageTaskSchema, type CodexUsageTask } from '@/shared/contracts/codex-usage';
import type {
  UsageWorkerMethod,
  UsageWorkerResponse,
} from '@/main/extensions/codex-usage-investigator/worker-protocol';

/** SQLite, parsing, statistics and export serialization run outside Electron's main process. */
export class CodexUsageWorkerClient {
  private worker: IsolatedExtensionProcess | null = null;
  private connecting: Promise<IsolatedExtensionProcess> | null = null;
  private sequence = 0;
  private running = false;
  private task: CodexUsageTask | null = null;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>();

  constructor(private readonly options: { dataDirectory: string; onTaskChanged(task: CodexUsageTask): void }) {}

  get hasPending() {
    return this.connecting !== null || this.running || this.pending.size > 0;
  }

  private async connect() {
    if (this.worker) return this.worker;
    if (this.connecting) return this.connecting;
    this.connecting = this.startProcess();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async startProcess() {
    let entry = path.join(__dirname, 'codex-usage-worker.js');
    try {
      await access(entry);
    } catch {
      entry = path.join(__dirname, '..', 'codex-usage-worker.js');
    }
    const worker = new IsolatedExtensionProcess(entry, 'AIY Codex Usage');
    this.worker = worker;
    const failed = (reason: Error) => {
      if (this.worker !== worker) return;
      this.worker = null;
      worker.terminate();
      this.running = false;
      for (const pending of this.pending.values())
        pending.reject(new Error('CODEX_USAGE_WORKER_FAILED', { cause: reason }));
      this.pending.clear();
      if (this.task?.status === 'RUNNING') {
        this.task = {
          ...this.task,
          status: 'FAILED',
          errorMessage: 'CODEX_USAGE_WORKER_FAILED',
          updatedAt: new Date().toISOString(),
        };
        this.notifyTaskChanged();
      }
    };
    worker.on('message', (message: UsageWorkerResponse) => {
      if (this.worker !== worker) return;
      if (!message || typeof message !== 'object') {
        failed(new Error('INVALID_WORKER_RESPONSE'));
        return;
      }
      if (message.kind === 'task') {
        const parsed = codexUsageTaskSchema.safeParse(message.task);
        if (!parsed.success) {
          failed(new Error('INVALID_WORKER_TASK'));
          return;
        }
        this.task = parsed.data;
        this.running = this.task.status === 'RUNNING';
        this.notifyTaskChanged();
      } else if (message.kind === 'result' && Number.isSafeInteger(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error));
        else pending?.resolve(message.value);
      } else failed(new Error('INVALID_WORKER_RESPONSE'));
    });
    worker.on('error', failed);
    worker.on('exit', (code) => failed(new Error(`CODEX_USAGE_WORKER_EXITED:${code}`)));
    try {
      worker.postMessage({ kind: 'configure', dataDirectory: this.options.dataDirectory });
    } catch (error) {
      failed(error instanceof Error ? error : new Error('CODEX_USAGE_WORKER_FAILED'));
      throw error;
    }
    return worker;
  }

  private notifyTaskChanged() {
    if (!this.task) return;
    try {
      this.options.onTaskChanged(this.task);
    } catch (error) {
      console.warn('[codex-usage] task notification failed', error);
    }
  }

  private invoke<K extends UsageWorkerMethod>(
    method: K,
    ...args: Parameters<CodexUsageInvestigator[K]>
  ): Promise<Awaited<ReturnType<CodexUsageInvestigator[K]>>> {
    if (this.pending.size >= 16) return Promise.reject(new Error('CODEX_USAGE_BUSY'));
    return new Promise((resolve, reject) => {
      void this.connect()
        .then((worker) => {
          if (this.pending.size >= 16) throw new Error('CODEX_USAGE_BUSY');
          const id = ++this.sequence;
          this.pending.set(id, {
            resolve: (value) => resolve(value as Awaited<ReturnType<CodexUsageInvestigator[K]>>),
            reject,
          });
          try {
            worker.postMessage({ id, method, args });
          } catch (error) {
            this.pending.delete(id);
            reject(error);
          }
        })
        .catch(reject);
    });
  }

  state(...args: Parameters<CodexUsageInvestigator['state']>) {
    return this.invoke('state', ...args);
  }
  investigation(...args: Parameters<CodexUsageInvestigator['investigation']>) {
    return this.invoke('investigation', ...args);
  }
  start(...args: Parameters<CodexUsageInvestigator['start']>) {
    return this.invoke('start', ...args);
  }
  resume(...args: Parameters<CodexUsageInvestigator['resume']>) {
    return this.invoke('resume', ...args);
  }
  resumeLatest() {
    return this.invoke('resumeLatest');
  }
  pause() {
    if (!this.worker && !this.connecting) return Promise.resolve();
    return this.invoke('pause');
  }
  cleanup(...args: Parameters<CodexUsageInvestigator['cleanup']>) {
    return this.invoke('cleanup', ...args);
  }
  export(...args: Parameters<CodexUsageInvestigator['export']>) {
    return this.invoke('export', ...args);
  }
}
