import { LanguagesIcon } from 'lucide-react';
import type { VideoDocumentTimedTranscriptContent } from '@/shared/contracts';
import { VIDEO_DOCUMENT_TRANSCRIPT_MAX_LOCALIZATIONS } from '@/shared/contracts/video-document';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { VideoDocumentTranslationLanguagePicker } from '@/renderer/features/video-documents/VideoDocumentTranslationLanguagePicker';
import type { VideoDocumentTranscriptTranslationModelSummary } from '@/renderer/features/video-documents/useVideoDocumentTranscriptTranslation';
import { useI18n } from '@/renderer/i18n/useI18n';

type TranslationLabels = ReturnType<typeof useI18n>['messages']['videoDocuments']['transcript']['translation'];

function translationErrorLabel(code: string, labels: TranslationLabels) {
  switch (code) {
    case 'VIDEO_DOCUMENT_TRANSCRIPT_REQUIRED':
    case 'VIDEO_DOCUMENT_TRANSLATION_TARGET_EXISTS':
    case 'VIDEO_DOCUMENT_TRANSLATION_SOURCE_EQUALS_TARGET':
    case 'VIDEO_DOCUMENT_TRANSLATION_LIMIT_REACHED':
    case 'VIDEO_DOCUMENT_TRANSLATION_OUTPUT_INVALID':
    case 'VIDEO_DOCUMENT_TRANSLATION_TIMEOUT':
    case 'VIDEO_DOCUMENT_GENERATION_BUSY':
    case 'VIDEO_DOCUMENT_MODEL_UNAVAILABLE':
    case 'VIDEO_DOCUMENT_CODEX_NOT_LOGGED_IN':
    case 'VIDEO_DOCUMENT_RATE_LIMITED':
    case 'VIDEO_DOCUMENT_CREDITS_DEPLETED':
    case 'VIDEO_DOCUMENT_WORKSPACE_USAGE_LIMIT':
    case 'VIDEO_DOCUMENT_TRANSLATION_INPUT_CHANGED':
    case 'CANCELLED':
    case 'VIDEO_DOCUMENT_TRANSLATION_FAILED':
      return labels.errors[code];
    default:
      return labels.failed;
  }
}

function excludedLocales(content: VideoDocumentTimedTranscriptContent | null) {
  const result = new Set<string>();
  for (const cue of content?.cues ?? []) {
    if (cue.textLocale && cue.textLocale !== 'und') result.add(cue.textLocale);
    for (const localization of cue.localizations ?? []) result.add(localization.locale);
  }
  return result;
}

function remainingTranslationCapacity(content: VideoDocumentTimedTranscriptContent | null) {
  const used = Math.max(0, ...(content?.cues ?? []).map((cue) => cue.localizations?.length ?? 0));
  return Math.max(0, VIDEO_DOCUMENT_TRANSCRIPT_MAX_LOCALIZATIONS - used);
}

interface Props {
  open: boolean;
  content: VideoDocumentTimedTranscriptContent | null;
  selected: string[];
  error: string | null;
  modelSummary: VideoDocumentTranscriptTranslationModelSummary | null;
  onOpenChange(open: boolean): void;
  onSelectedChange(locales: string[]): void;
  onStart(): void;
}

export function VideoDocumentTranscriptTranslationDialog({
  open,
  content,
  selected,
  error,
  modelSummary,
  onOpenChange,
  onSelectedChange,
  onStart,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments.transcript.translation;
  const modelLabel = modelSummary
    ? [
        modelSummary.routeName,
        modelSummary.modelName,
        modelSummary.reasoningEffort ? messages.aiCenter.routing.reasoningEfforts[modelSummary.reasoningEffort] : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '—';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LanguagesIcon className="size-5" />
            {labels.title}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
            <span className="text-sm text-foreground-secondary">{labels.model}</span>
            <span className="min-w-0 truncate text-sm font-medium" title={modelLabel}>
              {modelLabel}
            </span>
          </div>
          <span className="text-sm font-medium">{labels.targetLanguages}</span>
          <VideoDocumentTranslationLanguagePicker
            selected={selected}
            excluded={excludedLocales(content)}
            maxSelections={Math.min(5, remainingTranslationCapacity(content))}
            ariaLabel={labels.targetLanguages}
            onChange={onSelectedChange}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {translationErrorLabel(error, labels)}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {labels.cancel}
          </Button>
          <Button type="button" disabled={selected.length === 0} onClick={onStart}>
            <LanguagesIcon className="size-4" />
            {labels.start}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
