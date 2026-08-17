import { z } from 'zod';
import type { CodexAdapter } from '@/main/assistant/codex';
import type { LibraryDatabase } from '@/main/database';
import { normalizeVideoDocumentTokenUsage } from '@/main/video-documents/generation-pipeline';
import type {
  VideoDocumentGenerationErrorDetails,
  VideoDocumentTimedTranscriptContent,
  VideoDocumentTokenUsage,
  VideoDocumentTranscriptCue,
} from '@/shared/contracts/video-document';
import { VIDEO_DOCUMENT_TRANSCRIPT_MAX_LOCALIZATIONS } from '@/shared/contracts/video-document';
import type {
  VideoDocumentTranscriptTranslationResult,
  VideoDocumentTranscriptTranslationWorkerInput,
} from '@/shared/contracts/video-document-translation';
import { videoDocumentTranscriptTranslationResultSchema } from '@/shared/contracts/video-document-translation';

const MAX_BATCH_CUES = 40;
const MAX_BATCH_SOURCE_CHARACTERS = 8_000;
const MAX_PROVIDER_OUTPUT_CHARACTERS = 1_500_000;
const TRANSLATION_TURN_ABSOLUTE_TIMEOUT_MS = 6 * 60 * 60_000;
const DEFAULT_TRANSLATION_TURN_TIMEOUT_MS = 5 * 60_000;
const HIGH_TRANSLATION_TURN_TIMEOUT_MS = 10 * 60_000;
const MAX_TRANSLATION_TURN_TIMEOUT_MS = 15 * 60_000;
const ULTRA_TRANSLATION_TURN_TIMEOUT_MS = 20 * 60_000;

const translatedCueSchema = z
  .object({
    sourceIndex: z.preprocess((value) => {
      if (typeof value !== 'string') return value;
      const trimmed = value.trim();
      return /^[1-9]\d*$/.test(trimmed) ? Number(trimmed) : value;
    }, z.number().int().positive().safe()),
    text: z.string().trim().min(1).max(10_000),
  })
  .passthrough();
const translatedBatchSchema = z
  .object({ translations: z.array(translatedCueSchema).min(1).max(MAX_BATCH_CUES) })
  .passthrough();

const providerUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().nullable().optional(),
    cachedInputTokens: z.number().int().nonnegative().nullable().optional(),
    outputTokens: z.number().int().nonnegative().nullable().optional(),
    reasoningOutputTokens: z.number().int().nonnegative().nullable().optional(),
    totalTokens: z.number().int().nonnegative().nullable().optional(),
  })
  .passthrough();

function normalizedUsage(value: unknown) {
  const parsed = providerUsageSchema.safeParse(value);
  return parsed.success ? normalizeVideoDocumentTokenUsage(parsed.data) : null;
}

function errorWithCode(code: string, message: string, retryable: boolean, resetAt: string | null = null) {
  return Object.assign(new Error(message), { code, retryable, resetAt });
}

function preflightError(readiness: Awaited<ReturnType<CodexAdapter['preflightStructuredText']>>) {
  const code =
    readiness.status === 'NOT_LOGGED_IN'
      ? 'VIDEO_DOCUMENT_CODEX_NOT_LOGGED_IN'
      : readiness.status === 'MODEL_UNAVAILABLE'
        ? 'VIDEO_DOCUMENT_MODEL_UNAVAILABLE'
        : readiness.status === 'RATE_LIMITED'
          ? 'VIDEO_DOCUMENT_RATE_LIMITED'
          : readiness.status === 'CREDITS_DEPLETED'
            ? 'VIDEO_DOCUMENT_CREDITS_DEPLETED'
            : 'VIDEO_DOCUMENT_WORKSPACE_USAGE_LIMIT';
  return errorWithCode(
    code,
    readiness.diagnostics.map((diagnostic) => diagnostic.code).join(', ') || code,
    readiness.retryable,
    readiness.resetAt === null ? null : new Date(readiness.resetAt * 1_000).toISOString(),
  );
}

function translationFailure(error: unknown): VideoDocumentGenerationErrorDetails {
  const candidate = error && typeof error === 'object' ? error : null;
  const rawCode = candidate && 'code' in candidate && typeof candidate.code === 'string' ? candidate.code : null;
  const mappedCode =
    rawCode === 'CODEX_APP_SERVER_TURN_TIMEOUT' || rawCode === 'CODEX_APP_SERVER_TURN_IDLE_TIMEOUT'
      ? 'VIDEO_DOCUMENT_TRANSLATION_TIMEOUT'
      : rawCode;
  const code = mappedCode && /^[A-Z0-9_]{1,100}$/.test(mappedCode) ? mappedCode : 'VIDEO_DOCUMENT_TRANSLATION_FAILED';
  const retryable =
    candidate && 'retryable' in candidate && typeof candidate.retryable === 'boolean'
      ? candidate.retryable
      : ![
          'VIDEO_DOCUMENT_TRANSLATION_OUTPUT_INVALID',
          'VIDEO_DOCUMENT_TRANSLATION_TARGET_EXISTS',
          'VIDEO_DOCUMENT_TRANSLATION_SOURCE_EQUALS_TARGET',
          'VIDEO_DOCUMENT_TRANSCRIPT_REQUIRED',
        ].includes(code);
  const resetAt =
    candidate && 'resetAt' in candidate && typeof candidate.resetAt === 'string'
      ? candidate.resetAt.slice(0, 100)
      : null;
  const diagnostic = error instanceof Error ? error.message.trim().slice(0, 2_000) || null : null;
  return { code, retryable, resetAt, diagnostic };
}

function translationTurnTimeoutMs(
  effort: VideoDocumentTranscriptTranslationWorkerInput['execution']['reasoningEffort'],
) {
  if (effort === 'ultra') return ULTRA_TRANSLATION_TURN_TIMEOUT_MS;
  if (effort === 'max') return MAX_TRANSLATION_TURN_TIMEOUT_MS;
  if (effort === 'xhigh' || effort === 'high') return HIGH_TRANSLATION_TURN_TIMEOUT_MS;
  return DEFAULT_TRANSLATION_TURN_TIMEOUT_MS;
}

function usageFromError(error: unknown) {
  if (!error || typeof error !== 'object' || !('usage' in error)) return null;
  return normalizedUsage(error.usage);
}

function actualModelFromError(error: unknown) {
  if (!error || typeof error !== 'object' || !('actualModel' in error)) return null;
  return typeof error.actualModel === 'string' && error.actualModel.trim() ? error.actualModel.trim() : null;
}

function addUsage(left: VideoDocumentTokenUsage | null, right: VideoDocumentTokenUsage | null) {
  if (!left) return right;
  if (!right) return left;
  const sum = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));
  return {
    inputTokens: sum(left.inputTokens, right.inputTokens),
    cachedInputTokens: sum(left.cachedInputTokens, right.cachedInputTokens),
    outputTokens: sum(left.outputTokens, right.outputTokens),
    reasoningOutputTokens: sum(left.reasoningOutputTokens, right.reasoningOutputTokens),
    totalTokens: sum(left.totalTokens, right.totalTokens),
  };
}

function batches(cues: readonly VideoDocumentTranscriptCue[]) {
  const result: VideoDocumentTranscriptCue[][] = [];
  let current: VideoDocumentTranscriptCue[] = [];
  let characters = 0;
  for (const cue of cues) {
    if (
      current.length &&
      (current.length >= MAX_BATCH_CUES || characters + cue.text.length > MAX_BATCH_SOURCE_CHARACTERS)
    ) {
      result.push(current);
      current = [];
      characters = 0;
    }
    current.push(cue);
    characters += cue.text.length;
  }
  if (current.length) result.push(current);
  return result;
}

function sourceLocale(content: VideoDocumentTimedTranscriptContent) {
  const locales = new Set(
    content.cues.map((cue) => cue.textLocale).filter((locale): locale is string => Boolean(locale)),
  );
  return locales.size === 1 ? [...locales][0]! : 'und';
}

function assertTranslationTargetsAvailable(content: VideoDocumentTimedTranscriptContent, targetLocales: string[]) {
  const originalLocale = sourceLocale(content);
  if (targetLocales.includes(originalLocale)) {
    throw errorWithCode(
      'VIDEO_DOCUMENT_TRANSLATION_SOURCE_EQUALS_TARGET',
      `The transcript is already in ${originalLocale}`,
      false,
    );
  }
  const existing = new Set(content.cues.flatMap((cue) => (cue.localizations ?? []).map((item) => item.locale)));
  const duplicate = targetLocales.find((locale) => existing.has(locale));
  if (duplicate) {
    throw errorWithCode('VIDEO_DOCUMENT_TRANSLATION_TARGET_EXISTS', `A ${duplicate} transcript already exists`, false);
  }
  const largestLocalizationCount = Math.max(0, ...content.cues.map((cue) => cue.localizations?.length ?? 0));
  if (largestLocalizationCount + targetLocales.length > VIDEO_DOCUMENT_TRANSCRIPT_MAX_LOCALIZATIONS) {
    throw errorWithCode(
      'VIDEO_DOCUMENT_TRANSLATION_LIMIT_REACHED',
      'The transcript has reached its translation language limit',
      false,
    );
  }
}

function structuredJson(raw: string) {
  const trimmed = raw.trim();
  if (trimmed.length >= 6 && trimmed.startsWith('```') && trimmed.endsWith('```')) {
    return trimmed
      .slice(3, -3)
      .replace(/^json\s*/i, '')
      .trim();
  }
  return trimmed;
}

function schemaIssueSummary(error: z.ZodError) {
  return error.issues
    .slice(0, 8)
    .map((issue) => `${issue.path.length ? issue.path.join('.') : '$'}:${issue.code}`)
    .join(', ');
}

function parseTranslatedBatch(raw: string, expectedCues: readonly VideoDocumentTranscriptCue[]) {
  if (raw.length > MAX_PROVIDER_OUTPUT_CHARACTERS) {
    throw errorWithCode(
      'VIDEO_DOCUMENT_TRANSLATION_OUTPUT_INVALID',
      'Translation output exceeds its size limit',
      false,
    );
  }
  let unknown: unknown;
  try {
    unknown = JSON.parse(structuredJson(raw)) as unknown;
  } catch {
    throw errorWithCode('VIDEO_DOCUMENT_TRANSLATION_OUTPUT_INVALID', 'Translation output is not valid JSON', false);
  }
  const candidate = Array.isArray(unknown) ? { translations: unknown } : unknown;
  const parsed = translatedBatchSchema.safeParse(candidate);
  if (!parsed.success) {
    throw errorWithCode(
      'VIDEO_DOCUMENT_TRANSLATION_OUTPUT_INVALID',
      `Translation output does not match the schema (${schemaIssueSummary(parsed.error) || 'unknown issue'})`,
      false,
    );
  }
  const expected = expectedCues.map((cue) => cue.sourceIndex);
  const actual = parsed.data.translations.map((translation) => translation.sourceIndex);
  if (actual.length !== expected.length || actual.some((sourceIndex, index) => sourceIndex !== expected[index])) {
    throw errorWithCode(
      'VIDEO_DOCUMENT_TRANSLATION_OUTPUT_INVALID',
      'Translation output changed or reordered subtitle indexes',
      false,
    );
  }
  return parsed.data.translations;
}

function outputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['translations'],
    properties: {
      translations: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_BATCH_CUES,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sourceIndex', 'text'],
          properties: {
            sourceIndex: { type: 'integer', minimum: 1 },
            text: { type: 'string', minLength: 1, maxLength: 10_000 },
          },
        },
      },
    },
  };
}

function promptFor(targetLocale: string, cues: readonly VideoDocumentTranscriptCue[]) {
  return [
    `Translate the following timed transcript cues into ${targetLocale}.`,
    'Keep every sourceIndex exactly once and in the same order. Preserve meaning, tone, names, numbers, and subtitle readability.',
    'Do not add commentary. Return only the requested JSON object.',
    JSON.stringify({ targetLocale, cues: cues.map(({ sourceIndex, text }) => ({ sourceIndex, text })) }),
  ].join('\n\n');
}

function translatedContent(
  content: VideoDocumentTimedTranscriptContent,
  targetLocales: readonly string[],
  translations: ReadonlyMap<string, ReadonlyMap<number, string>>,
): VideoDocumentTimedTranscriptContent {
  const originalLocale = sourceLocale(content);
  return {
    ...content,
    schemaVersion: 2,
    cues: content.cues.map((cue) => ({
      ...cue,
      textLocale: cue.textLocale ?? originalLocale,
      localizations: [
        ...(cue.localizations ?? []),
        ...targetLocales.map((locale) => ({ locale, text: translations.get(locale)!.get(cue.sourceIndex)! })),
      ],
    })),
  };
}

export class VideoDocumentTranscriptTranslationService {
  constructor(
    private readonly database: LibraryDatabase,
    private readonly codex: CodexAdapter,
  ) {}

  async translate(
    input: VideoDocumentTranscriptTranslationWorkerInput,
    signal?: AbortSignal,
  ): Promise<VideoDocumentTranscriptTranslationResult> {
    const document = this.database.getVideoDocument(input.documentId);
    const branch = document.branches.find((candidate) => candidate.role === 'CLEAN_TRANSCRIPT');
    if (!branch) throw errorWithCode('VIDEO_DOCUMENT_TRANSCRIPT_REQUIRED', 'Transcript branch is unavailable', false);
    const revision = branch.latestDraftRevisionId ? this.database.getLatestVideoDocumentRevision(branch.id) : null;
    const run = this.database.startVideoDocumentTranslation({
      operationId: input.operationId,
      documentId: input.documentId,
      branchId: branch.id,
      inputRevisionId: revision?.id ?? null,
      targetLocales: input.targetLocales,
      execution: input.execution,
    });
    let actualModel: string | null = null;
    let usage: VideoDocumentTokenUsage | null = null;
    try {
      if (!revision || revision.content.format !== 'TIMED_TRANSCRIPT') {
        throw errorWithCode('VIDEO_DOCUMENT_TRANSCRIPT_REQUIRED', 'Create or import a transcript first', false);
      }
      assertTranslationTargetsAvailable(revision.content, input.targetLocales);
      const readiness = await this.codex.preflightStructuredText(
        { model: input.execution.modelKey, effort: input.execution.reasoningEffort },
        signal,
      );
      if (!readiness.canStartTurn) throw preflightError(readiness);
      const cueBatches = batches(revision.content.cues);
      const totalBatches = cueBatches.length * input.targetLocales.length;
      this.database.updateVideoDocumentTranslationProgress({
        operationId: input.operationId,
        completedBatches: 0,
        totalBatches,
      });
      const translations = new Map<string, Map<number, string>>();
      let completedBatches = 0;
      for (const targetLocale of input.targetLocales) {
        const translatedByIndex = new Map<number, string>();
        translations.set(targetLocale, translatedByIndex);
        for (const batch of cueBatches) {
          const providerResult = await this.codex.runStructuredText(
            {
              scopeId: `video-transcript-translation:${input.operationId}`,
              title: `Subtitle translation · ${targetLocale}`,
              developerInstructions:
                'You are a professional subtitle translator. Follow the supplied JSON schema and never alter cue identifiers.',
              prompt: promptFor(targetLocale, batch),
              model: input.execution.modelKey,
              effort: input.execution.reasoningEffort,
              localImages: [],
              outputSchema: outputSchema(),
              timeoutMs: TRANSLATION_TURN_ABSOLUTE_TIMEOUT_MS,
              idleTimeoutMs: translationTurnTimeoutMs(input.execution.reasoningEffort),
            },
            signal,
            { preflightReadiness: readiness },
          );
          actualModel = providerResult.actualModel;
          usage = addUsage(usage, normalizedUsage(providerResult.usage));
          for (const translated of parseTranslatedBatch(providerResult.finalMessage, batch)) {
            translatedByIndex.set(translated.sourceIndex, translated.text);
          }
          completedBatches += 1;
          this.database.updateVideoDocumentTranslationProgress({
            operationId: input.operationId,
            completedBatches,
            totalBatches,
          });
        }
      }
      const latest = this.database.getLatestVideoDocumentRevision(branch.id);
      if (!latest || latest.id !== revision.id) {
        throw errorWithCode(
          'VIDEO_DOCUMENT_TRANSLATION_INPUT_CHANGED',
          'The transcript changed while translation was running',
          true,
        );
      }
      return videoDocumentTranscriptTranslationResultSchema.parse(
        this.database.commitVideoDocumentTranslation({
          documentId: input.documentId,
          revision: {
            branchId: branch.id,
            expectedParentRevisionId: revision.id,
            content: translatedContent(revision.content, input.targetLocales, translations),
          },
          completion: {
            operationId: input.operationId,
            actualModel: actualModel ?? input.execution.modelKey,
            usage,
            completedBatches: totalBatches,
            totalBatches,
            finishedAt: new Date().toISOString(),
          },
        }),
      );
    } catch (error) {
      const failedUsage = addUsage(usage, usageFromError(error));
      const failed = this.database.failVideoDocumentTranslation({
        operationId: run.id,
        failure: translationFailure(error),
        actualModel: actualModelFromError(error) ?? actualModel,
        usage: failedUsage,
        finishedAt: new Date().toISOString(),
      });
      return videoDocumentTranscriptTranslationResultSchema.parse({ run: failed, revision: null });
    }
  }
}
