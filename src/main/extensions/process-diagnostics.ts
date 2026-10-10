import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { RendererDiagnosticLog } from '@/main/app/renderer-diagnostic-log';
import { isPackagedApplication } from '@/main/app/runtime-mode';
import { extensionDiagnosticSchema } from '@/main/extensions/diagnostic-protocol';
import { rendererDiagnosticError } from '@/shared/renderer-diagnostic-error';

let log: RendererDiagnosticLog | null = null;
const runId = randomUUID();

export function createExtensionProcessDiagnostics(service: string) {
  // Check the actual application mode, not NODE_ENV or a user-supplied flag.
  if (process.type !== 'browser') return null;
  try {
    const { app } = createRequire(__filename)('electron') as typeof import('electron');
    if (isPackagedApplication(app)) return null;
    if (!log) {
      log = new RendererDiagnosticLog(path.join(app.getPath('userData'), 'diagnostics', 'extensions'), 'extensions');
      log.write({
        event: 'development-session',
        runId,
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
        node: process.versions.node,
      });
    }
    return new ExtensionProcessDiagnostics(log, service);
  } catch {
    return null;
  }
}

export async function flushExtensionDiagnostics() {
  await log?.flush();
}

class ExtensionProcessDiagnostics {
  private readonly processId = randomUUID();
  private childPid: number | null = null;
  private readonly startedAt = performance.now();
  private readonly pending = new Map<number, { operation: string; startedAt: number }>();
  private stderrBytes = 0;
  private stderrTail = Buffer.alloc(0);

  constructor(
    private readonly output: RendererDiagnosticLog,
    private readonly service: string,
  ) {}

  record(event: string, details: object = {}) {
    try {
      this.output.write({
        runId,
        processId: this.processId,
        service: this.service,
        childPid: this.childPid,
        event,
        details,
      });
    } catch {
      // Logging must not escape into process lifecycle handlers.
    }
  }

  spawned(pid: number | undefined) {
    this.childPid = pid ?? null;
    this.record('process-spawned', { durationMs: Math.round(performance.now() - this.startedAt) });
  }

  failed(error: unknown) {
    this.record('process-error', rendererDiagnosticError(error));
  }

  exited(code: number | null, signal: string | null, expected: boolean) {
    this.record('process-exited', {
      code,
      signal,
      expected,
      durationMs: Math.round(performance.now() - this.startedAt),
      pending: [...this.pending].map(([id, request]) => ({
        id,
        operation: request.operation,
        durationMs: Math.round(performance.now() - request.startedAt),
      })),
    });
    this.pending.clear();
  }

  message(direction: 'send' | 'receive', raw: unknown) {
    try {
      if (!raw || typeof raw !== 'object') return;
      const message = raw as Record<string, unknown>;
      if (message.kind === 'configure') {
        const config = message.configuration as Record<string, unknown> | undefined;
        this.record('configured', {
          role: config?.role,
          device: config?.device,
          modelFingerprint: config?.fingerprint,
        });
        return;
      }
      const id = typeof message.id === 'number' && Number.isSafeInteger(message.id) ? message.id : null;
      if (id === null) return;
      if (direction === 'send') {
        if (message.kind === 'cancel') {
          this.record('request-cancelled', { id });
          return;
        }
        const command = message.command as Record<string, unknown> | undefined;
        const operation = command?.op ?? message.method;
        if (typeof operation !== 'string' || !/^[\w-]{1,80}$/.test(operation)) return;
        if (this.pending.size < 32) this.pending.set(id, { operation, startedAt: performance.now() });
        this.record('request-started', {
          id,
          operation,
          itemCount: Array.isArray(command?.items) ? command.items.length : undefined,
          queryLength: typeof command?.query === 'string' ? command.query.length : undefined,
        });
      } else this.response(id, message);
    } catch {
      this.record('diagnostic-message-invalid');
    }
  }

  private response(id: number, message: Record<string, unknown>) {
    const request = this.pending.get(id);
    this.pending.delete(id);
    const execution = message.execution as Record<string, unknown> | undefined;
    this.record('request-finished', {
      id,
      operation: request?.operation,
      durationMs: request ? Math.round(performance.now() - request.startedAt) : undefined,
      succeeded: !('error' in message),
      backend: execution?.backend === 'cpu' || execution?.backend === 'webgpu' ? execution.backend : null,
      fallback: execution?.fallback === true,
      errorCode:
        typeof message.error === 'string' && /^[A-Z][A-Z0-9_:-]{0,80}$/.test(message.error) ? message.error : undefined,
      ...('error' in message ? { error: rendererDiagnosticError(message.error) } : {}),
    });
  }

  worker(raw: unknown) {
    const parsed = extensionDiagnosticSchema.safeParse(raw);
    if (!parsed.success) return;
    this.record('worker-stage', { ...parsed.data, requestIds: [...this.pending.keys()] });
  }

  stderr(chunk: Buffer) {
    // Native crash messages can arrive in bursts. Bound each record and the
    // lifetime budget independently of the rotating writer's backlog limit.
    const budget = 64 * 1024;
    this.stderrTail = Buffer.concat([this.stderrTail, chunk.subarray(-8_192)]).subarray(-8_192);
    if (this.stderrBytes >= budget) return;
    const bytes = Math.min(chunk.byteLength, 4_096, budget - this.stderrBytes);
    this.stderrBytes += bytes;
    this.record('process-stderr', {
      text: chunk.subarray(0, bytes).toString('utf8'),
      truncated: bytes < chunk.byteLength || this.stderrBytes >= budget,
    });
  }

  stderrEnded() {
    // Preserve the final native crash message even after verbose startup output
    // has exhausted the streaming budget.
    if (this.stderrBytes >= 64 * 1024)
      for (let offset = 0; offset < this.stderrTail.length; offset += 4_096)
        this.record('process-stderr-tail', { text: this.stderrTail.subarray(offset, offset + 4_096).toString('utf8') });
    this.stderrTail = Buffer.alloc(0);
  }
}
