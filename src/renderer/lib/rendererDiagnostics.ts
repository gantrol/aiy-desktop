import type { RendererDiagnosticInput } from '@/shared/contracts/renderer-diagnostics';
import { rendererDiagnosticError } from '@/shared/renderer-diagnostic-error';

export function recordRendererDiagnostic(
  event: RendererDiagnosticInput['event'],
  details: RendererDiagnosticInput['details'] = {},
) {
  try {
    window.desktopApi?.rendererDiagnosticRecord?.({ event, details });
  } catch {
    /* Best effort only. */
  }
}

export function reportRendererError(
  event: 'react-uncaught' | 'react-caught' | 'react-recoverable' | 'renderer-error' | 'renderer-rejection',
  error: unknown,
) {
  recordRendererDiagnostic(event, { error: rendererDiagnosticError(error) });
}

export function installRendererDiagnostics() {
  const onError = (event: ErrorEvent) => reportRendererError('renderer-error', event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => reportRendererError('renderer-rejection', event.reason);
  const onPageHide = () => recordRendererDiagnostic('renderer-pagehide');
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('pagehide', onPageHide);
  recordRendererDiagnostic('renderer-entry');
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('pagehide', onPageHide);
  };
}
