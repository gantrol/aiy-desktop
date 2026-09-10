import { useCallback, useRef, useState } from 'react';
import { recordRendererDiagnostic } from '@/renderer/lib/rendererDiagnostics';

/** Log each resource once per isolated demo session; retries start a new session. */
export function useDemoLoadDiagnostics(token: string, currentTime: { current: number }) {
  const [failed, setFailed] = useState(false);
  const startedAt = useRef(performance.now());
  const reported = useRef(new Set<string>());
  const fail = useCallback(
    (resource: string) => {
      setFailed(true);
      if (reported.current.has(`failed:${resource}`)) return;
      reported.current.add(`failed:${resource}`);
      recordRendererDiagnostic('demo-load-failed', {
        sessionId: token,
        demoResources: [resource],
        demoTime: currentTime.current,
        durationMs: performance.now() - startedAt.current,
      });
    },
    [token, currentTime],
  );
  const reportReady = useCallback(
    (resource: string) => {
      if (reported.current.has(resource)) return;
      reported.current.add(resource);
      recordRendererDiagnostic('demo-load-ready', {
        sessionId: token,
        demoResources: [resource],
        demoTime: currentTime.current,
        durationMs: performance.now() - startedAt.current,
      });
    },
    [token, currentTime],
  );
  return { failed, fail, reportReady };
}
