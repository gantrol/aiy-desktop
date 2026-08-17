import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  VideoDocumentDto,
  VideoDocumentTranscriptBackgroundTask,
  VideoDocumentTranscriptBackgroundTaskStatus,
  VideoDocumentTranscriptRecognitionErrorCode,
  VideoDocumentTranscriptRecognitionProgress,
} from '@/shared/contracts';

interface Options {
  document: VideoDocumentDto | null;
  selectedDocumentIdRef: { current: string | null };
  setDocument(document: VideoDocumentDto): void;
  setTitle(title: string): void;
  updateSummary(document: VideoDocumentDto): void;
  refreshNavigation(): void;
}

export function useVideoDocumentTranscriptRecognition({
  document,
  selectedDocumentIdRef,
  setDocument,
  setTitle,
  updateSummary,
  refreshNavigation,
}: Options) {
  const [dialogOpen, setDialogOpenState] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [progress, setProgress] = useState<VideoDocumentTranscriptRecognitionProgress | null>(null);
  const [error, setError] = useState<VideoDocumentTranscriptRecognitionErrorCode | null>(null);
  const [taskStartedAt, setTaskStartedAt] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<VideoDocumentTranscriptBackgroundTaskStatus | null>(null);
  const [backgroundBusy, setBackgroundBusy] = useState(false);
  const operationIdRef = useRef<string | null>(null);
  const operationDocumentIdRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const taskSnapshotRevisionRef = useRef(-1);
  const documentIdRef = useRef(document?.id ?? null);
  const successApplyRef = useRef<{ operationId: string; promise: Promise<void> } | null>(null);

  const clearRunningOperation = useCallback((operationId: string) => {
    if (operationIdRef.current !== operationId) return false;
    runningRef.current = false;
    operationIdRef.current = null;
    operationDocumentIdRef.current = null;
    setRecognizing(false);
    setCancelling(false);
    setTaskStatus(null);
    return true;
  }, []);

  const applySucceededRecognition = useCallback(
    async (targetDocumentId: string) => {
      let updated: VideoDocumentDto;
      try {
        updated = await window.desktopApi.videoDocumentGet(targetDocumentId);
      } catch {
        if (selectedDocumentIdRef.current === targetDocumentId) {
          refreshNavigation();
          setCompleted(true);
        }
        return;
      }
      if (selectedDocumentIdRef.current !== targetDocumentId) return;
      setDocument(updated);
      setTitle(updated.title);
      updateSummary(updated);
      refreshNavigation();
      setCompleted(true);
    },
    [refreshNavigation, selectedDocumentIdRef, setDocument, setTitle, updateSummary],
  );

  const applySucceededRecognitionOnce = useCallback(
    (operationId: string, targetDocumentId: string) => {
      const existing = successApplyRef.current;
      if (existing?.operationId === operationId) return existing.promise;
      const promise = applySucceededRecognition(targetDocumentId);
      successApplyRef.current = { operationId, promise };
      return promise;
    },
    [applySucceededRecognition],
  );

  const attachTask = useCallback(
    (task: VideoDocumentTranscriptBackgroundTask) => {
      if (task.documentId !== document?.id) return;
      operationIdRef.current = task.operationId;
      operationDocumentIdRef.current = task.documentId;
      runningRef.current = true;
      setTaskStartedAt(task.startedAt);
      setTaskStatus(task.status);
      setRecognizing(true);
      setCancelling(task.status === 'CANCELLING');
      setError(null);
      setCompleted(false);
      setProgress(
        task.totalChunks === null
          ? null
          : {
              operationId: task.operationId,
              documentId: task.documentId,
              completedChunks: task.completedChunks,
              totalChunks: task.totalChunks,
            },
      );
    },
    [document?.id],
  );

  useEffect(
    () =>
      window.desktopApi.onVideoDocumentTranscriptRecognitionProgress((next) => {
        if (next.operationId === operationIdRef.current) setProgress(next);
      }),
    [],
  );

  useEffect(() => {
    const nextDocumentId = document?.id ?? null;
    if (documentIdRef.current === nextDocumentId) return;
    documentIdRef.current = nextDocumentId;
    if (operationDocumentIdRef.current !== nextDocumentId) {
      operationIdRef.current = null;
      operationDocumentIdRef.current = null;
      runningRef.current = false;
    }
    setRecognizing(false);
    setCancelling(false);
    setTaskStatus(null);
    setProgress(null);
    setDialogOpenState(false);
    setError(null);
    setCompleted(false);
    setTaskStartedAt(null);
  }, [document?.id]);

  useEffect(() => {
    let mounted = true;
    const applyTasks = (revision: number, tasks: VideoDocumentTranscriptBackgroundTask[]) => {
      if (!mounted || revision < taskSnapshotRevisionRef.current) return;
      taskSnapshotRevisionRef.current = revision;
      setBackgroundBusy(tasks.length > 0);
      const task = tasks.find((candidate) => candidate.documentId === document?.id);
      if (task) attachTask(task);
    };
    const unsubscribe = window.desktopApi.onVideoDocumentTranscriptBackgroundTasksChanged((event) => {
      applyTasks(event.revision, event.tasks);
      const terminal = event.terminal;
      if (!terminal || terminal.documentId !== document?.id) return;
      if (operationIdRef.current && operationIdRef.current !== terminal.operationId) return;
      clearRunningOperation(terminal.operationId);
      if (terminal.status === 'failed') {
        setError(terminal.code);
        setDialogOpenState(true);
        return;
      }
      void applySucceededRecognitionOnce(terminal.operationId, terminal.documentId);
    });
    void window.desktopApi
      .videoDocumentTranscriptBackgroundTasksGet()
      .then((snapshot) => applyTasks(snapshot.revision, snapshot.tasks))
      .catch(() => undefined);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [applySucceededRecognitionOnce, attachTask, clearRunningOperation, document?.id]);

  const setDialogOpen = useCallback((open: boolean) => setDialogOpenState(open), []);

  const recognize = useCallback(async () => {
    if (!document || runningRef.current || backgroundBusy) return false;
    const targetDocumentId = document.id;
    const operationId = crypto.randomUUID();
    runningRef.current = true;
    operationIdRef.current = operationId;
    operationDocumentIdRef.current = targetDocumentId;
    setTaskStartedAt(new Date().toISOString());
    setTaskStatus('STARTING');
    setRecognizing(true);
    setCancelling(false);
    setProgress(null);
    setError(null);
    setCompleted(false);
    setDialogOpenState(false);
    try {
      const result = await window.desktopApi.videoDocumentTranscriptRecognize({
        operationId,
        documentId: targetDocumentId,
        providerKey: 'qwen-local',
      });
      if (result.status === 'failed') {
        if (selectedDocumentIdRef.current === targetDocumentId) {
          setError(result.code);
          setDialogOpenState(true);
        }
        return false;
      }
      await applySucceededRecognitionOnce(operationId, targetDocumentId);
      return true;
    } catch {
      if (selectedDocumentIdRef.current === targetDocumentId) {
        setError('UNKNOWN');
        setDialogOpenState(true);
      }
      return false;
    } finally {
      clearRunningOperation(operationId);
    }
  }, [applySucceededRecognitionOnce, backgroundBusy, clearRunningOperation, document, selectedDocumentIdRef]);

  const start = recognize;

  const cancel = useCallback(async () => {
    const operationId = operationIdRef.current;
    if (!operationId || !runningRef.current || cancelling) return;
    setCancelling(true);
    setTaskStatus('CANCELLING');
    try {
      await window.desktopApi.videoDocumentTranscriptRecognitionCancel(operationId);
    } catch {
      setError('UNKNOWN');
      setCancelling(false);
    }
  }, [cancelling]);

  const canRecognize = Boolean(
    document?.source.available && document.source.audio.status === 'HAS_AUDIO' && !backgroundBusy,
  );
  const hasTranscript = Boolean(
    document?.branches.find((branch) => branch.role === 'CLEAN_TRANSCRIPT')?.latestDraftRevisionId,
  );

  const activate = useCallback(() => {
    if (runningRef.current || error || hasTranscript) {
      if (!runningRef.current && !error) {
        setProgress(null);
        setCompleted(false);
        setTaskStartedAt(null);
        setTaskStatus(null);
      }
      setDialogOpenState(true);
      return;
    }
    void start();
  }, [error, hasTranscript, start]);

  return {
    start,
    workspaceProps: {
      recognizing,
      canRecognize,
      recognitionProgress: progress,
      recognitionTaskStatus: taskStatus,
      onRecognize: activate,
    },
    dialogProps: {
      open: dialogOpen,
      hasTranscript,
      durationMs: document?.source.asset.durationMs ?? null,
      recognizing,
      cancelling,
      completed,
      progress,
      error,
      taskStartedAt,
      taskStatus,
      onOpenChange: setDialogOpen,
      onRecognize: recognize,
      onCancel: cancel,
    },
  };
}
