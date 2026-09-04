import { ipcRenderer } from 'electron';
import {
  RENDERER_DIAGNOSTIC_CHANNEL,
  rendererDiagnosticInputSchema,
  type RendererDiagnosticDetails,
  type RendererDiagnosticInput,
} from '@/shared/contracts/renderer-diagnostics';
import { rendererDiagnosticError } from '@/shared/renderer-diagnostic-error';

const pageId = crypto.randomUUID();
let requestSequence = 0;

export function recordRendererDiagnostic(input: RendererDiagnosticInput) {
  try {
    const parsed = rendererDiagnosticInputSchema.safeParse(input);
    if (parsed.success)
      ipcRenderer.send(RENDERER_DIAGNOSTIC_CHANNEL, {
        ...parsed.data,
        pageId,
        elapsedMs: performance.now(),
      });
  } catch {
    // Logging must never fail an input event or an unload operation.
  }
}

export async function traceRendererRequest<T>(
  kind: 'bootstrap' | 'post-ipc',
  operation: () => Promise<T>,
  metadata: RendererDiagnosticDetails = {},
): Promise<T> {
  const start = performance.now();
  const details = { ...metadata, requestId: `${pageId}:${++requestSequence}` };
  recordRendererDiagnostic({ event: `${kind}-start`, details });
  const slow = setTimeout(
    () =>
      recordRendererDiagnostic({
        event: `${kind}-slow`,
        details: { ...details, durationMs: performance.now() - start },
      }),
    5_000,
  );
  try {
    const result = await operation();
    recordRendererDiagnostic({
      event: `${kind}-success`,
      details: { ...details, durationMs: performance.now() - start },
    });
    return result;
  } catch (error) {
    recordRendererDiagnostic({
      event: `${kind}-failure`,
      details: {
        ...details,
        durationMs: performance.now() - start,
        error: rendererDiagnosticError(error),
      },
    });
    throw error;
  } finally {
    clearTimeout(slow);
  }
}
