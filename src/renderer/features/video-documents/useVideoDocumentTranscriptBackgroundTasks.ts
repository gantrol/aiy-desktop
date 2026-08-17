import { useEffect, useState } from 'react';
import type {
  VideoDocumentTranscriptBackgroundTask,
  VideoDocumentTranscriptBackgroundTaskSnapshot,
  VideoDocumentTranscriptBackgroundTaskTerminal,
} from '@/shared/contracts';

interface LocalSnapshot {
  revision: number;
  tasks: VideoDocumentTranscriptBackgroundTask[];
}

export function useVideoDocumentTranscriptBackgroundTasks() {
  const [snapshot, setSnapshot] = useState<LocalSnapshot>({ revision: -1, tasks: [] });
  const [lastTerminal, setLastTerminal] = useState<VideoDocumentTranscriptBackgroundTaskTerminal | null>(null);

  useEffect(() => {
    let mounted = true;
    const apply = (next: VideoDocumentTranscriptBackgroundTaskSnapshot) => {
      if (!mounted) return;
      setSnapshot((current) => (next.revision >= current.revision ? next : current));
    };
    const unsubscribe = window.desktopApi.onVideoDocumentTranscriptBackgroundTasksChanged((event) => {
      apply({ revision: event.revision, tasks: event.tasks });
      if (event.terminal) setLastTerminal(event.terminal);
    });
    void window.desktopApi
      .videoDocumentTranscriptBackgroundTasksGet()
      .then(apply)
      .catch(() => undefined);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  return { tasks: snapshot.tasks, lastTerminal };
}
