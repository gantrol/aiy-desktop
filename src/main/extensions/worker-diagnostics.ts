import { parentPort, threadId } from 'node:worker_threads';
import type { ExtensionDiagnosticDetails } from '@/main/extensions/diagnostic-protocol';
import { rendererDiagnosticError } from '@/shared/renderer-diagnostic-error';

/** The host clears this flag for packaged runs; children never write log files. */
export function writeWorkerDiagnostic(event: string, details: ExtensionDiagnosticDetails = {}, error?: unknown) {
  if (process.env.AIY_EXTENSION_DIAGNOSTICS !== '1') return;
  try {
    const failure = error === undefined ? null : rendererDiagnosticError(error);
    const message = {
      kind: 'extension-diagnostic',
      at: new Date().toISOString(),
      event,
      childPid: process.pid,
      threadId,
      rss: process.memoryUsage.rss(),
      details: {
        ...details,
        ...(failure
          ? {
              errorName: failure.name,
              errorCategory: failure.category,
              errorStack: failure.stack.join('\n').slice(0, 4_096),
            }
          : {}),
      },
    };
    if (parentPort) parentPort.postMessage(message);
    else if (process.parentPort) process.parentPort.postMessage(message);
    else if (process.connected) process.send?.(message, undefined, undefined, () => undefined);
  } catch {
    // A diagnostic failure must never change the task's outcome.
  }
}
