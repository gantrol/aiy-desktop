import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { CodexUsageInvestigator } from '@/main/extensions/codex-usage-investigator';
import { codexUsageTaskSchema, type CodexUsageTask } from '@/shared/contracts/codex-usage';
import type {
  UsageWorkerMethod,
  UsageWorkerResponse,
} from '@/main/extensions/codex-usage-investigator/worker-protocol';

/** SQLite, parsing, statistics and export serialization never run on Electron's main thread. */
export class CodexUsageWorkerClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private running = false;
  private task: CodexUsageTask | null = null;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(reason: Error): void }>();

  constructor(private readonly options: { dataDirectory: string; onTaskChanged(task: CodexUsageTask): void }) {}

  get hasPending() {
    return this.running || this.pending.size > 0;
  }

  private connect() {
    if (this.worker) return this.worker;
    const worker = new Worker(path.join(__dirname, 'codex-usage-worker.js'), {
      workerData: { dataDirectory: this.options.dataDirectory },
    });
    this.worker = worker;
    worker.unref();
    worker.on('message', (message: UsageWorkerResponse) => {
      if (message.kind === 'task') {
        this.task = codexUsageTaskSchema.parse(message.task);
        this.running = this.task.status === 'RUNNING';
        this.options.onTaskChanged(this.task);
      } else {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error));
        else pending?.resolve(message.value);
      }
    });
    const failed = (reason: Error) => {
      if (this.worker !== worker) return;
      this.worker = null;
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
        this.options.onTaskChanged(this.task);
      }
    };
    worker.on('error', failed);
    worker.on('exit', (code) => failed(new Error(`CODEX_USAGE_WORKER_EXITED:${code}`)));
    return worker;
  }

  private invoke<K extends UsageWorkerMethod>(
    method: K,
    ...args: Parameters<CodexUsageInvestigator[K]>
  ): Promise<Awaited<ReturnType<CodexUsageInvestigator[K]>>> {
    if (this.pending.size >= 16) return Promise.reject(new Error('CODEX_USAGE_BUSY'));
    const worker = this.connect();
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
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
    return this.invoke('pause');
  }
  cleanup(...args: Parameters<CodexUsageInvestigator['cleanup']>) {
    return this.invoke('cleanup', ...args);
  }
  export(...args: Parameters<CodexUsageInvestigator['export']>) {
    return this.invoke('export', ...args);
  }
}
