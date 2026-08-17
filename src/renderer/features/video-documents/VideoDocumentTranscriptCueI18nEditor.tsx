import type { VideoDocumentTranscriptCue } from '@/shared/contracts/video-document';
import {
  I18nTextInput,
  isI18nTextValueValid,
  type I18nTextTranslation,
} from '@/renderer/components/ui/i18n-text-input';

const UNDETERMINED_LANGUAGE = 'und';

export interface VideoDocumentTranscriptCueI18nDraft {
  text: string;
  textLocale: string;
  localizations: I18nTextTranslation[];
}

export interface VideoDocumentTranscriptCueI18nLabels {
  language: string;
  text: string;
  addLanguage: string;
  removeLanguage: string;
  expandLanguages: string;
  collapseLanguages: string;
}

function canonicalLocale(value: string) {
  try {
    return Intl.getCanonicalLocales(value.trim())[0] ?? null;
  } catch {
    return null;
  }
}

function baseLanguage(locale: string) {
  return locale.split('-', 1)[0]?.toLocaleLowerCase() ?? locale.toLocaleLowerCase();
}

export function transcriptCueI18nDraft(cue: VideoDocumentTranscriptCue): VideoDocumentTranscriptCueI18nDraft {
  return {
    text: cue.text,
    textLocale: cue.textLocale ?? UNDETERMINED_LANGUAGE,
    localizations: (cue.localizations ?? []).map((localization) => ({
      locale: localization.locale,
      value: localization.text,
    })),
  };
}

export function normalizeTranscriptCueI18nDraft(draft: VideoDocumentTranscriptCueI18nDraft) {
  if (!isI18nTextValueValid(draft.text, draft.textLocale, draft.localizations)) return null;
  const textLocale = canonicalLocale(draft.textLocale);
  if (!textLocale) return null;
  const locales = new Set([textLocale]);
  const localizations: NonNullable<VideoDocumentTranscriptCue['localizations']> = [];
  for (const localization of draft.localizations) {
    const locale = canonicalLocale(localization.locale);
    const text = localization.value.trim();
    if (!locale || !text || locales.has(locale)) return null;
    locales.add(locale);
    localizations.push({ locale, text });
  }
  return { text: draft.text.trim(), textLocale, localizations };
}

export function localizedTranscriptCueText(cue: VideoDocumentTranscriptCue, requestedLocale: string) {
  const canonicalRequestedLocale = canonicalLocale(requestedLocale);
  if (!canonicalRequestedLocale) return cue.text;
  const candidates = [
    ...(cue.textLocale ? [{ locale: cue.textLocale, text: cue.text }] : []),
    ...(cue.localizations ?? []),
  ];
  const exact = candidates.find((candidate) => canonicalLocale(candidate.locale) === canonicalRequestedLocale);
  if (exact) return exact.text;
  const requestedLanguage = baseLanguage(canonicalRequestedLocale);
  return (
    candidates.find((candidate) => {
      const locale = canonicalLocale(candidate.locale);
      return locale ? baseLanguage(locale) === requestedLanguage : false;
    })?.text ?? cue.text
  );
}

export function transcriptCueLocalizedText(cue: VideoDocumentTranscriptCue, requestedLocale: string) {
  const canonicalRequestedLocale = canonicalLocale(requestedLocale);
  if (!canonicalRequestedLocale) return null;
  const candidates = cue.localizations ?? [];
  return candidates.find((candidate) => canonicalLocale(candidate.locale) === canonicalRequestedLocale)?.text ?? null;
}

export function VideoDocumentTranscriptCueI18nEditor({
  draft,
  labels,
  autoFocus,
  defaultOpen,
  className,
  onChange,
}: {
  draft: VideoDocumentTranscriptCueI18nDraft;
  labels: VideoDocumentTranscriptCueI18nLabels;
  autoFocus?: boolean;
  defaultOpen?: boolean;
  className?: string;
  onChange(draft: VideoDocumentTranscriptCueI18nDraft): void;
}) {
  return (
    <I18nTextInput
      value={draft.text}
      locale={draft.textLocale}
      translations={draft.localizations}
      labels={{
        language: labels.language,
        value: labels.text,
        addLanguage: labels.addLanguage,
        removeLanguage: labels.removeLanguage,
        expandLanguages: labels.expandLanguages,
        collapseLanguages: labels.collapseLanguages,
      }}
      valueMaxLength={10_000}
      autoFocus={autoFocus}
      defaultOpen={defaultOpen}
      multiline
      className={className}
      onValueChange={(text) => onChange({ ...draft, text })}
      onLocaleChange={(textLocale) => onChange({ ...draft, textLocale })}
      onTranslationsChange={(localizations) => onChange({ ...draft, localizations })}
    />
  );
}
