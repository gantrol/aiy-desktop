import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoKeyChangeResultDto } from '@/shared/contracts';

interface VideoKeyChangeErrorLabels {
  ffmpegUnavailable: string;
  busy: string;
  extractFailed: string;
}

interface Options {
  active: boolean;
  documentId: string | null;
  sourceAssetId: string | null;
  articleActive: boolean;
  errorLabels: VideoKeyChangeErrorLabels;
  notify(message: string): void;
}

export function useVideoKeyChanges({ active, documentId, sourceAssetId, articleActive, errorLabels, notify }: Options) {
  const [result, setResult] = useState<VideoKeyChangeResultDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [seekRequest, setSeekRequest] = useState<{ timestampMs: number; revision: number } | null>(null);
  const currentDocumentId = useRef(documentId);
  currentDocumentId.current = documentId;

  useEffect(() => {
    setResult(null);
    setExtracting(false);
    setSeekRequest(null);
  }, [documentId, sourceAssetId]);

  useEffect(() => {
    if (!active || !documentId || !articleActive) return undefined;
    let current = true;
    setLoading(true);
    void window.desktopApi
      .videoDocumentKeyChangesGet(documentId)
      .then((next) => {
        if (!current) return;
        setResult(next);
        setLoading(false);
      })
      .catch((reason) => {
        if (!current) return;
        setLoading(false);
        notify(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      current = false;
    };
  }, [active, articleActive, documentId, notify, sourceAssetId]);

  async function extract() {
    if (!documentId || extracting) return;
    const targetDocumentId = documentId;
    setExtracting(true);
    try {
      const next = await window.desktopApi.videoDocumentKeyChangesExtract({ documentId: targetDocumentId });
      if (currentDocumentId.current === targetDocumentId) setResult(next);
    } catch (reason) {
      if (currentDocumentId.current !== targetDocumentId) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      notify(
        message.includes('VIDEO_KEY_CHANGES_FFMPEG_UNAVAILABLE')
          ? errorLabels.ffmpegUnavailable
          : message.includes('VIDEO_KEY_CHANGES_BUSY')
            ? errorLabels.busy
            : errorLabels.extractFailed,
      );
    } finally {
      setExtracting(false);
    }
  }

  const seek = useCallback((timestampMs: number) => {
    setSeekRequest((current) => ({ timestampMs, revision: (current?.revision ?? 0) + 1 }));
  }, []);

  return { result, loading, extracting, seekRequest, extract, seek };
}
