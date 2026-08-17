import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AssistantReasoningEffort,
  AssistantRoutingDto,
  VideoDocumentDto,
  VideoDocumentTimedTranscriptContent,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';

export interface VideoDocumentTranscriptTranslationModelSummary {
  routeName: string;
  modelName: string;
  reasoningEffort: AssistantReasoningEffort | null;
}

export interface VideoDocumentTranscriptTranslationProgress {
  completedBatches: number;
  totalBatches: number | null;
  startedAt: string;
  elapsedSeconds: number;
}

function translationModelSummary(routing: AssistantRoutingDto): VideoDocumentTranscriptTranslationModelSummary | null {
  const selection = routing.selections.subtitleTranslation;
  const route = routing.models.find((candidate) => candidate.key === selection.routeKey);
  if (!route) return null;
  const modelKey = selection.modelKey ?? route.modelKey;
  return {
    routeName: route.name,
    modelName: route.modelOptions.find((candidate) => candidate.key === modelKey)?.name ?? modelKey,
    reasoningEffort: selection.reasoningEffort ?? route.reasoningEffort,
  };
}

interface Options {
  document: VideoDocumentDto | null;
  content: VideoDocumentTimedTranscriptContent | null;
  selectedDocumentIdRef: { current: string | null };
  setDocument(document: VideoDocumentDto): void;
  setTitle(title: string): void;
  updateSummary(document: VideoDocumentDto): void;
  refreshNavigation(): void;
  notify(message: string): void;
}

export function useVideoDocumentTranscriptTranslation({
  document,
  content,
  selectedDocumentIdRef,
  setDocument,
  setTitle,
  updateSummary,
  refreshNavigation,
  notify,
}: Options) {
  const labels = useI18n().messages.videoDocuments.transcript.translation;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [translating, setTranslating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<VideoDocumentTranscriptTranslationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelSummary, setModelSummary] = useState<VideoDocumentTranscriptTranslationModelSummary | null>(null);
  const mountedRef = useRef(true);
  const pendingDocumentIdRef = useRef<string | null>(null);
  const pendingOperationIdRef = useRef<string | null>(null);
  const observedRunningRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    observedRunningRef.current = false;
    const pendingHere = pendingDocumentIdRef.current === document?.id;
    setTranslating(pendingHere);
    if (!pendingHere) {
      setCancelling(false);
      setProgress(null);
    }
  }, [document?.id]);

  useEffect(() => {
    if (!translating) return;
    const timer = window.setInterval(() => {
      setProgress((current) =>
        current
          ? {
              ...current,
              elapsedSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(current.startedAt)) / 1_000)),
            }
          : current,
      );
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [translating]);

  useEffect(() => {
    if (!dialogOpen) return;
    let disposed = false;
    void window.desktopApi
      .assistantRoutingGet()
      .then((routing) => {
        if (!disposed && mountedRef.current) setModelSummary(translationModelSummary(routing));
      })
      .catch(() => {
        if (!disposed && mountedRef.current) setModelSummary(null);
      });
    return () => {
      disposed = true;
    };
  }, [dialogOpen]);

  const refreshDocument = useCallback(
    async (documentId: string) => {
      if (selectedDocumentIdRef.current !== documentId) return;
      const updated = await window.desktopApi.videoDocumentGet(documentId);
      if (selectedDocumentIdRef.current !== documentId || !mountedRef.current) return;
      setDocument(updated);
      setTitle(updated.title);
      updateSummary(updated);
      refreshNavigation();
    },
    [refreshNavigation, selectedDocumentIdRef, setDocument, setTitle, updateSummary],
  );

  useEffect(() => {
    const documentId = document?.id;
    if (!documentId) return;
    let disposed = false;
    const inspect = async () => {
      try {
        const page = await window.desktopApi.videoDocumentAiActivitiesList({ cursor: null, limit: 100 });
        if (disposed) return;
        const running = page.items.find(
          (activity) =>
            activity.type === 'TRANSCRIPT_TRANSLATION' &&
            activity.run.documentId === documentId &&
            activity.run.status === 'RUNNING',
        );
        if (running?.type === 'TRANSCRIPT_TRANSLATION') {
          observedRunningRef.current = true;
          setProgress({
            completedBatches: running.run.completedBatches,
            totalBatches: running.run.totalBatches,
            startedAt: running.run.startedAt,
            elapsedSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(running.run.startedAt)) / 1_000)),
          });
        } else if (observedRunningRef.current) {
          observedRunningRef.current = false;
          void refreshDocument(documentId).catch(() => undefined);
        }
        if (pendingDocumentIdRef.current !== documentId) {
          setTranslating(Boolean(running));
          if (!running) setProgress(null);
        }
      } catch {
        // AI Center history is the durable source; transient refresh failures do not stop the active invocation.
      }
    };
    void inspect();
    const timer = window.setInterval(() => void inspect(), 3_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [document?.id, refreshDocument]);

  const start = useCallback(
    (targetLocales: string[]) => {
      if (!document || translating || targetLocales.length === 0) return false;
      const documentId = document.id;
      const operationId = crypto.randomUUID();
      const startedAt = new Date().toISOString();
      pendingDocumentIdRef.current = documentId;
      pendingOperationIdRef.current = operationId;
      setTranslating(true);
      setCancelling(false);
      setProgress({ completedBatches: 0, totalBatches: null, startedAt, elapsedSeconds: 0 });
      setError(null);
      setDialogOpen(false);
      notify(labels.started);
      void window.desktopApi
        .videoDocumentTranscriptTranslate({ operationId, documentId, targetLocales })
        .then(async (result) => {
          if (result.run.status === 'CANCELLED') {
            notify(labels.cancelled);
            return;
          }
          if (result.run.status !== 'SUCCEEDED' || !result.revision) {
            if (mountedRef.current && selectedDocumentIdRef.current === documentId) {
              setError(result.run.errorCode ?? 'VIDEO_DOCUMENT_TRANSLATION_FAILED');
              setDialogOpen(true);
            }
            notify(labels.failed);
            return;
          }
          await refreshDocument(documentId);
          notify(labels.completed);
        })
        .catch(() => {
          if (!mountedRef.current) return;
          if (selectedDocumentIdRef.current === documentId) {
            setError('VIDEO_DOCUMENT_TRANSLATION_FAILED');
            setDialogOpen(true);
          }
          notify(labels.failed);
        })
        .finally(() => {
          if (pendingDocumentIdRef.current === documentId) pendingDocumentIdRef.current = null;
          if (pendingOperationIdRef.current === operationId) pendingOperationIdRef.current = null;
          if (mountedRef.current && selectedDocumentIdRef.current === documentId) {
            setTranslating(false);
            setCancelling(false);
            setProgress(null);
          }
        });
      return true;
    },
    [
      document,
      labels.completed,
      labels.cancelled,
      labels.failed,
      labels.started,
      notify,
      refreshDocument,
      selectedDocumentIdRef,
      translating,
    ],
  );

  const cancel = useCallback(() => {
    const operationId = pendingOperationIdRef.current;
    if (!operationId || cancelling) return;
    setCancelling(true);
    void window.desktopApi.videoDocumentTranscriptTranslationCancel(operationId).catch(() => {
      if (mountedRef.current) setCancelling(false);
      notify(labels.failed);
    });
  }, [cancelling, labels.failed, notify]);

  const open = useCallback(() => {
    setSelected([]);
    setDialogOpen(true);
  }, []);

  return {
    start,
    workspaceProps: {
      translating,
      translationCancelling: cancelling,
      translationProgress: progress,
      onTranslate: open,
      onCancelTranslation: cancel,
    },
    dialogProps: {
      open: dialogOpen,
      content,
      selected,
      error,
      modelSummary,
      onOpenChange: setDialogOpen,
      onSelectedChange: setSelected,
      onStart: () => void start(selected),
    },
  };
}
