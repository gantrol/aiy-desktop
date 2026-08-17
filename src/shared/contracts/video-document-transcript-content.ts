import { z } from 'zod';

export interface VideoDocumentTranscriptCueLocalization {
  locale: string;
  text: string;
}

export interface VideoDocumentTranscriptCue {
  sourceIndex: number;
  startTimestampMs: number;
  endTimestampMs: number;
  text: string;
  textLocale?: string;
  localizations?: VideoDocumentTranscriptCueLocalization[];
}

export interface VideoDocumentTimedTranscriptContent {
  schemaVersion: 1 | 2;
  format: 'TIMED_TRANSCRIPT';
  transcriptBasis: 'AUDIO_TRANSCRIPT' | 'EXTERNAL_SUBTITLES' | 'EMBEDDED_SUBTITLES';
  textTreatment: 'VERBATIM' | 'CLEANED';
  sourceFileName: string;
  sourceHash: string;
  rawText: string;
  cues: VideoDocumentTranscriptCue[];
}

export const VIDEO_DOCUMENT_TRANSCRIPT_MAX_LOCALIZATIONS = 10;

const videoDocumentTranscriptLocaleSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(
    (locale) => {
      try {
        return Intl.getCanonicalLocales(locale)[0] === locale;
      } catch {
        return false;
      }
    },
    { message: 'Transcript locales must be canonical BCP 47 language tags' },
  );

export const videoDocumentTranscriptCueLocalizationSchema = z
  .object({
    locale: videoDocumentTranscriptLocaleSchema,
    text: z.string().min(1).max(10_000),
  })
  .strict();

const videoDocumentTranscriptCueV1Schema = z
  .object({
    sourceIndex: z.number().int().positive(),
    startTimestampMs: z.number().int().nonnegative(),
    endTimestampMs: z.number().int().nonnegative(),
    text: z.string().min(1).max(10_000),
    textLocale: z.never().optional(),
    localizations: z.never().optional(),
  })
  .strict()
  .refine((cue) => cue.endTimestampMs >= cue.startTimestampMs, {
    message: 'A transcript cue end time cannot precede its start time',
    path: ['endTimestampMs'],
  });

const videoDocumentTranscriptCueV2Schema = z
  .object({
    sourceIndex: z.number().int().positive(),
    startTimestampMs: z.number().int().nonnegative(),
    endTimestampMs: z.number().int().nonnegative(),
    text: z.string().min(1).max(10_000),
    textLocale: videoDocumentTranscriptLocaleSchema,
    localizations: z
      .array(videoDocumentTranscriptCueLocalizationSchema)
      .max(VIDEO_DOCUMENT_TRANSCRIPT_MAX_LOCALIZATIONS),
  })
  .strict()
  .superRefine((cue, context) => {
    if (cue.endTimestampMs < cue.startTimestampMs) {
      context.addIssue({
        code: 'custom',
        message: 'A transcript cue end time cannot precede its start time',
        path: ['endTimestampMs'],
      });
    }
    const locales = new Set([cue.textLocale]);
    for (const [index, localization] of cue.localizations.entries()) {
      if (locales.has(localization.locale)) {
        context.addIssue({
          code: 'custom',
          message: 'Transcript cue localization locales must be unique',
          path: ['localizations', index, 'locale'],
        });
      }
      locales.add(localization.locale);
    }
  });

export const videoDocumentTranscriptCueSchema = z
  .union([videoDocumentTranscriptCueV1Schema, videoDocumentTranscriptCueV2Schema])
  .transform((cue): VideoDocumentTranscriptCue => cue);

const videoDocumentTimedTranscriptV1ContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    format: z.literal('TIMED_TRANSCRIPT'),
    transcriptBasis: z.enum(['AUDIO_TRANSCRIPT', 'EXTERNAL_SUBTITLES', 'EMBEDDED_SUBTITLES']),
    textTreatment: z.enum(['VERBATIM', 'CLEANED']),
    sourceFileName: z.string().trim().min(1).max(300),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    rawText: z.string().min(1).max(2_000_000),
    cues: z.array(videoDocumentTranscriptCueV1Schema).min(1).max(20_000),
  })
  .strict();

const videoDocumentTimedTranscriptV2ContentSchema = z
  .object({
    schemaVersion: z.literal(2),
    format: z.literal('TIMED_TRANSCRIPT'),
    transcriptBasis: z.enum(['AUDIO_TRANSCRIPT', 'EXTERNAL_SUBTITLES', 'EMBEDDED_SUBTITLES']),
    textTreatment: z.enum(['VERBATIM', 'CLEANED']),
    sourceFileName: z.string().trim().min(1).max(300),
    sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
    rawText: z.string().min(1).max(2_000_000),
    cues: z.array(videoDocumentTranscriptCueV2Schema).min(1).max(20_000),
  })
  .strict();

export const videoDocumentTimedTranscriptContentSchema = z
  .union([videoDocumentTimedTranscriptV1ContentSchema, videoDocumentTimedTranscriptV2ContentSchema])
  .superRefine((content, context) => {
    const sourceIndexes = new Set<number>();
    let previousStartTimestampMs = -1;
    let localizedTextCharacters = 0;
    for (const [index, cue] of content.cues.entries()) {
      if (sourceIndexes.has(cue.sourceIndex)) {
        context.addIssue({
          code: 'custom',
          message: 'Transcript cue source indexes must be unique',
          path: ['cues', index, 'sourceIndex'],
        });
      }
      sourceIndexes.add(cue.sourceIndex);
      if (cue.startTimestampMs < previousStartTimestampMs) {
        context.addIssue({
          code: 'custom',
          message: 'Transcript cues must be ordered by start time',
          path: ['cues', index, 'startTimestampMs'],
        });
      }
      previousStartTimestampMs = cue.startTimestampMs;
      localizedTextCharacters += (cue.localizations ?? []).reduce(
        (characters, localization) => characters + localization.text.length,
        0,
      );
      if (localizedTextCharacters > 4_000_000) {
        context.addIssue({
          code: 'custom',
          message: 'Transcript cue localizations exceed the bounded text size',
          path: ['cues', index, 'localizations'],
        });
        break;
      }
    }
  })
  .transform((content): VideoDocumentTimedTranscriptContent => content);
