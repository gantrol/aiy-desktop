import { LanguagesIcon, LoaderCircleIcon, PlusIcon, XIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { VideoDocumentTimedTranscriptContent } from '@/shared/contracts/video-document';
import { VIDEO_DOCUMENT_TRANSCRIPT_MAX_LOCALIZATIONS } from '@/shared/contracts/video-document';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Button } from '@/renderer/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { VideoDocumentTranscriptTranslationProgress } from '@/renderer/features/video-documents/useVideoDocumentTranscriptTranslation';

export const ORIGINAL_TRANSCRIPT_LANGUAGE = '__original__';

export type VideoDocumentTranscriptDisplayMode = 'SINGLE' | 'BILINGUAL';

export interface VideoDocumentTranscriptLanguageOption {
  locale: string;
  translatedCueCount: number;
}

function canonicalLocale(value: string) {
  try {
    return Intl.getCanonicalLocales(value.trim())[0] ?? null;
  } catch {
    return null;
  }
}

export function transcriptLanguageOptions(
  content: VideoDocumentTimedTranscriptContent,
): VideoDocumentTranscriptLanguageOption[] {
  const counts = new Map<string, number>();
  for (const cue of content.cues) {
    const cueLocales = new Set<string>();
    for (const localization of cue.localizations ?? []) {
      const locale = canonicalLocale(localization.locale);
      if (locale) cueLocales.add(locale);
    }
    for (const locale of cueLocales) counts.set(locale, (counts.get(locale) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([locale, translatedCueCount]) => ({ locale, translatedCueCount }))
    .sort((left, right) => left.locale.localeCompare(right.locale));
}

export function useVideoDocumentTranscriptLanguageView(content: VideoDocumentTimedTranscriptContent | null) {
  const [selectedLanguage, setSelectedLanguage] = useState(ORIGINAL_TRANSCRIPT_LANGUAGE);
  const [displayMode, setDisplayMode] = useState<VideoDocumentTranscriptDisplayMode>('SINGLE');
  const availableLanguages = useMemo(
    () => (content ? transcriptLanguageOptions(content).map((option) => option.locale) : []),
    [content],
  );

  useEffect(() => {
    setSelectedLanguage((current) =>
      current === ORIGINAL_TRANSCRIPT_LANGUAGE || availableLanguages.includes(current)
        ? current
        : ORIGINAL_TRANSCRIPT_LANGUAGE,
    );
  }, [availableLanguages]);

  useEffect(() => {
    if (selectedLanguage === ORIGINAL_TRANSCRIPT_LANGUAGE) setDisplayMode('SINGLE');
  }, [selectedLanguage]);

  function selectLanguage(language: string) {
    setSelectedLanguage(language);
    if (language === ORIGINAL_TRANSCRIPT_LANGUAGE) setDisplayMode('SINGLE');
  }

  return { selectedLanguage, displayMode, selectLanguage, setDisplayMode };
}

function transcriptOriginalLocale(content: VideoDocumentTimedTranscriptContent) {
  const locales = new Set(
    content.cues
      .map((cue) => (cue.textLocale ? canonicalLocale(cue.textLocale) : null))
      .filter((locale): locale is string => Boolean(locale) && locale !== 'und'),
  );
  return locales.size === 1 ? [...locales][0]! : null;
}

function languageName(language: string, displayLocale: string) {
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(language) ?? language;
  } catch {
    return language;
  }
}

function formatElapsed(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function VideoDocumentTranscriptLanguageBar({
  content,
  selectedLanguage,
  displayMode,
  onLanguageChange,
  onDisplayModeChange,
  translating = false,
  translationProgress = null,
  translationCancelling = false,
  onTranslate,
  onCancelTranslation,
}: {
  content: VideoDocumentTimedTranscriptContent;
  selectedLanguage: string;
  displayMode: VideoDocumentTranscriptDisplayMode;
  onLanguageChange(language: string): void;
  onDisplayModeChange(mode: VideoDocumentTranscriptDisplayMode): void;
  translating?: boolean;
  translationProgress?: VideoDocumentTranscriptTranslationProgress | null;
  translationCancelling?: boolean;
  onTranslate?(): void;
  onCancelTranslation?(): void;
}) {
  const { locale, messages } = useI18n();
  const labels = messages.videoDocuments.transcript.languageView;
  const options = transcriptLanguageOptions(content);
  const originalLocale = transcriptOriginalLocale(content);
  const originalLabel = originalLocale
    ? labels.originalWithLanguage(languageName(originalLocale, locale))
    : labels.original;
  const canAddTranslation = content.cues.every(
    (cue) => (cue.localizations?.length ?? 0) < VIDEO_DOCUMENT_TRANSCRIPT_MAX_LOCALIZATIONS,
  );
  const elapsed = translationProgress ? formatElapsed(translationProgress.elapsedSeconds) : null;
  const translationStatus =
    elapsed && translationProgress?.totalBatches
      ? labels.translatingProgress(translationProgress.completedBatches, translationProgress.totalBatches, elapsed)
      : elapsed
        ? labels.translatingElapsed(elapsed)
        : labels.translating;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b py-3">
      <Select value={selectedLanguage} onValueChange={onLanguageChange}>
        <SelectTrigger className="w-56 max-w-full" aria-label={labels.language}>
          <LanguagesIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ORIGINAL_TRANSCRIPT_LANGUAGE}>{originalLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.locale} value={option.locale}>
              {labels.translationOption(
                languageName(option.locale, locale),
                option.translatedCueCount,
                content.cues.length,
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex flex-wrap items-center gap-2">
        {translating ? (
          <>
            <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircleIcon className="size-4 animate-spin" />
              <span className="tabular-nums">{translationStatus}</span>
            </span>
            {onCancelTranslation && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={translationCancelling}
                onClick={onCancelTranslation}
              >
                {translationCancelling ? (
                  <LoaderCircleIcon className="size-4 animate-spin" />
                ) : (
                  <XIcon className="size-4" />
                )}
                {translationCancelling ? labels.cancellingTranslation : labels.cancelTranslation}
              </Button>
            )}
          </>
        ) : onTranslate && canAddTranslation ? (
          <Button type="button" variant="outline" size="sm" disabled={translating} onClick={onTranslate}>
            <PlusIcon className="size-4" />
            {labels.addTranslation}
          </Button>
        ) : null}
        <Segmented
          type="single"
          value={displayMode}
          aria-label={labels.displayMode}
          onValueChange={(value) => {
            if (value === 'SINGLE' || value === 'BILINGUAL') onDisplayModeChange(value);
          }}
        >
          <SegmentedItem value="SINGLE">{labels.single}</SegmentedItem>
          <SegmentedItem value="BILINGUAL" disabled={selectedLanguage === ORIGINAL_TRANSCRIPT_LANGUAGE}>
            {labels.bilingual}
          </SegmentedItem>
        </Segmented>
      </div>
    </div>
  );
}
