import { useEffect, useState } from 'react';
import type { IntakeVideoMimeType } from '@/shared/contracts';
import { intakeMediaMimeType, isIntakeVideoMimeType } from '@/renderer/features/intake/intakeImageFormats';
import { intakePreview, releaseIntakePreview } from '@/renderer/features/intake/intakePreview';

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

export interface VideoDocumentLocalFileInfo {
  mimeType: IntakeVideoMimeType;
  width: number;
  height: number;
  durationMs: number;
}

interface ErrorLabels {
  unsupported: string;
  tooLarge: string;
  unreadable: string;
}

export function videoDocumentFileStem(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').trim() || fileName;
}

export function formatVideoDocumentDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatVideoDocumentFileSize(byteSize: number) {
  return `${(byteSize / (1024 * 1024)).toFixed(byteSize >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function useVideoDocumentLocalFile(file: File | null, enabled: boolean, labels: ErrorLabels) {
  const [sourceUrl, setSourceUrl] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [mediaInfo, setMediaInfo] = useState<VideoDocumentLocalFileInfo | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled || !file) {
      setSourceUrl('');
      setPreviewUrl('');
      setMediaInfo(null);
      setReading(false);
      setError('');
      return undefined;
    }

    let current = true;
    let nextSourceUrl = '';
    let nextPreviewUrl = '';
    setMediaInfo(null);
    setSourceUrl('');
    setPreviewUrl('');
    setReading(false);
    setError('');
    const mimeType = intakeMediaMimeType(file);
    if (!mimeType || !isIntakeVideoMimeType(mimeType)) {
      setError(labels.unsupported);
      return undefined;
    }
    if (file.size <= 0 || file.size > MAX_VIDEO_BYTES) {
      setError(labels.tooLarge);
      return undefined;
    }

    nextSourceUrl = URL.createObjectURL(file);
    setSourceUrl(nextSourceUrl);
    setReading(true);
    void intakePreview(file, true)
      .then((preview) => {
        nextPreviewUrl = preview.url;
        if (!current) {
          releaseIntakePreview(preview.url);
          return;
        }
        setPreviewUrl(preview.url);
        setMediaInfo({
          mimeType,
          width: preview.width,
          height: preview.height,
          durationMs: preview.durationMs ?? 0,
        });
        setReading(false);
      })
      .catch(() => {
        if (!current) return;
        setReading(false);
        setError(labels.unreadable);
      });

    return () => {
      current = false;
      if (nextSourceUrl) URL.revokeObjectURL(nextSourceUrl);
      if (nextPreviewUrl) releaseIntakePreview(nextPreviewUrl);
    };
  }, [enabled, file, labels.tooLarge, labels.unreadable, labels.unsupported]);

  return { sourceUrl, previewUrl, mediaInfo, reading, error };
}
