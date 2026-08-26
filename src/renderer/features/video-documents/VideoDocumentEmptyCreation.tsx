import { CaptionsIcon, FileTextIcon, LanguagesIcon, LoaderCircleIcon, UploadIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  VideoDocumentTranscriptBackgroundTaskStatus,
  VideoDocumentTranscriptRecognitionProgress,
} from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { VideoDocumentTranslationLanguagePicker } from '@/renderer/features/video-documents/VideoDocumentTranslationLanguagePicker';

export interface VideoDocumentEmptyCreationSelection {
  transcript: boolean;
  article: boolean;
  translationLocales: string[];
}

interface Props {
  documentId: string;
  hasAudio: boolean;
  canRecognize: boolean;
  recognizing: boolean;
  importingTranscript: boolean;
  progress: VideoDocumentTranscriptRecognitionProgress | null;
  taskStatus: VideoDocumentTranscriptBackgroundTaskStatus | null;
  onStart(selection: VideoDocumentEmptyCreationSelection): Promise<void>;
  onOpenProgress(): void;
  onImportTranscript(selection: VideoDocumentEmptyCreationSelection): Promise<void>;
}

function outputCardClass(selected: boolean, disabled: boolean) {
  return cn(
    'flex min-h-32 cursor-pointer items-start gap-3 rounded-xl border p-4 text-left transition-colors',
    selected ? 'border-selected-border bg-selected/45' : 'bg-card hover:bg-accent/45',
    disabled && 'cursor-default opacity-60',
  );
}

function recognitionProgressLabel(
  status: VideoDocumentTranscriptBackgroundTaskStatus | null,
  progress: VideoDocumentTranscriptRecognitionProgress | null,
  labels: ReturnType<typeof useI18n>['messages']['videoDocuments']['creation'],
) {
  if (status === 'CANCELLING') return labels.cancelling;
  if (status === 'STARTING' || !progress) return labels.starting;
  const percent = Math.min(100, Math.round((progress.completedChunks / progress.totalChunks) * 100));
  return labels.recognizing(percent);
}

export function VideoDocumentEmptyCreation({
  documentId,
  hasAudio,
  canRecognize,
  recognizing,
  importingTranscript,
  progress,
  taskStatus,
  onStart,
  onOpenProgress,
  onImportTranscript,
}: Props) {
  const labels = useI18n().messages.videoDocuments.creation;
  const [selection, setSelection] = useState<VideoDocumentEmptyCreationSelection>({
    transcript: true,
    article: true,
    translationLocales: [],
  });
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    setSelection({ transcript: true, article: true, translationLocales: [] });
    setStarting(false);
  }, [documentId]);

  const busy = recognizing || starting || importingTranscript;
  const canStart = selection.transcript && hasAudio && canRecognize && !busy;

  async function start() {
    if (!canStart) return;
    setStarting(true);
    try {
      await onStart(selection);
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-auto p-6 sm:p-10">
      <section className="m-auto grid w-full max-w-2xl gap-6" aria-labelledby="video-document-creation-title">
        <header className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-selected text-selected-foreground">
            <FileTextIcon className="size-5" />
          </span>
          <div>
            <h2 id="video-document-creation-title" className="text-xl font-semibold">
              {labels.title}
            </h2>
            <p className="text-sm text-muted-foreground">{labels.selectOutputs}</p>
          </div>
        </header>

        <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label={labels.selectOutputs}>
          <label className={outputCardClass(selection.transcript, busy)}>
            <Checkbox
              checked={selection.transcript}
              disabled={busy}
              aria-label={labels.transcript}
              onCheckedChange={(checked) =>
                setSelection((current) => ({
                  transcript: checked === true,
                  article: checked === true ? current.article : false,
                  translationLocales: checked === true ? current.translationLocales : [],
                }))
              }
            />
            <span className="grid gap-2">
              <CaptionsIcon className="size-5 text-selected-foreground" />
              <span>
                <strong className="block text-sm font-medium">{labels.transcript}</strong>
                <span className="mt-1 block text-xs text-muted-foreground">{labels.transcriptDetail}</span>
              </span>
            </span>
          </label>

          <label className={outputCardClass(selection.article, busy)}>
            <Checkbox
              checked={selection.article}
              disabled={busy}
              aria-label={labels.article}
              onCheckedChange={(checked) =>
                setSelection((current) => ({
                  ...current,
                  transcript: checked === true ? true : current.transcript,
                  article: checked === true,
                }))
              }
            />
            <span className="grid gap-2">
              <FileTextIcon className="size-5 text-selected-foreground" />
              <span>
                <strong className="block text-sm font-medium">{labels.article}</strong>
                <span className="mt-1 block text-xs text-muted-foreground">{labels.articleDetail}</span>
              </span>
            </span>
          </label>
        </div>

        {selection.transcript && (
          <section className="grid gap-3 rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2">
              <LanguagesIcon className="size-4 text-selected-foreground" />
              <strong className="text-sm font-medium">{labels.translationLanguages}</strong>
            </div>
            <VideoDocumentTranslationLanguagePicker
              selected={selection.translationLocales}
              disabled={busy}
              ariaLabel={labels.translationLanguages}
              onChange={(translationLocales) => setSelection((current) => ({ ...current, translationLocales }))}
            />
          </section>
        )}

        {!hasAudio && <p className="text-sm text-muted-foreground">{labels.audioRequired}</p>}

        <div className="flex flex-wrap items-center gap-2">
          {recognizing ? (
            <Button type="button" onClick={onOpenProgress}>
              <LoaderCircleIcon className="size-4 animate-spin" />
              {recognitionProgressLabel(taskStatus, progress, labels)}
            </Button>
          ) : (
            <Button type="button" disabled={!canStart} onClick={() => void start()}>
              {starting ? <LoaderCircleIcon className="size-4 animate-spin" /> : <FileTextIcon className="size-4" />}
              {starting ? labels.starting : selection.article ? labels.startBoth : labels.startTranscript}
            </Button>
          )}
          <Button type="button" variant="outline" disabled={busy} onClick={() => void onImportTranscript(selection)}>
            {importingTranscript ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <UploadIcon className="size-4" />
            )}
            {importingTranscript
              ? labels.importing
              : selection.article
                ? labels.importAndCreate
                : labels.importTranscript}
          </Button>
        </div>
      </section>
    </div>
  );
}
