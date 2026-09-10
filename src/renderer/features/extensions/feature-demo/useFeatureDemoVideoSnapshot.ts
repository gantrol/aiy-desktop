import { useEffect, useRef, useState } from 'react';
import type { VideoDocumentRevisionDto, VideoKeyChangeResultDto } from '@/shared/contracts';

export interface FeatureDemoVideoSnapshot {
  durationMs: number;
  previewUrl: string;
  article: VideoDocumentRevisionDto | null;
  transcript: VideoDocumentRevisionDto | null;
  keyChanges: VideoKeyChangeResultDto | null;
}

export type FeatureDemoVideoState =
  | { status: 'idle' | 'loading' | 'empty' | 'error'; snapshot: null }
  | { status: 'ready'; snapshot: FeatureDemoVideoSnapshot };

async function readSnapshot(signal: AbortSignal): Promise<FeatureDemoVideoSnapshot | null> {
  const { featureDemoVideoSample } = await import('./featureDemoVideoSample');
  signal.throwIfAborted();
  return featureDemoVideoSample;
}

// Load the bundled sample only for its chapter or export. Replay reuses it.
export function useFeatureDemoVideoSnapshot(active: boolean): FeatureDemoVideoState {
  const cache = useRef<FeatureDemoVideoSnapshot | null>(null);
  const [state, setState] = useState<FeatureDemoVideoState>({ status: 'idle', snapshot: null });
  useEffect(() => {
    if (!active || cache.current) return;
    const controller = new AbortController();
    setState({ status: 'loading', snapshot: null });
    const timeout = window.setTimeout(() => {
      controller.abort();
      setState({ status: 'error', snapshot: null });
    }, 15_000);
    void readSnapshot(controller.signal)
      .then((snapshot) => {
        if (controller.signal.aborted) return;
        cache.current = snapshot;
        setState(snapshot ? { status: 'ready', snapshot } : { status: 'empty', snapshot: null });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: 'error', snapshot: null });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [active]);
  return active && state.status === 'idle' ? { status: 'loading', snapshot: null } : state;
}
