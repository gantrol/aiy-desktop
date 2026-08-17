import { z } from 'zod';
import type { VideoDocumentTimedTranscriptContent, VideoDocumentTokenUsage } from '@/shared/contracts';
import type { CodexAdapter } from '@/main/assistant/codex';
import type { CodexAppServerReadiness } from '@/main/extensions/codex-app-server/client';
import type { VideoKeyChangeModelEvidence } from '@/main/video-documents/key-change-service';
import { VideoDocumentGenerationCheckpointStore } from '@/main/video-documents/generation-checkpoint-store';
import {
  videoDocumentChapterPlanOutputSchema,
  videoDocumentChapterPlanSchema,
  type VideoDocumentClassificationConfidence,
  type VideoDocumentDraftBatch,
  videoDocumentDraftBatchOutputSchema,
  videoDocumentDraftBatchSchema,
  type VideoDocumentProfile,
} from '@/main/video-documents/generation-profile';
import {
  buildVideoDocumentDeveloperInstructions,
  buildVideoDocumentDraftPrompt,
  buildVideoDocumentPlanPrompt,
  VIDEO_DOCUMENT_PROMPT_PROFILE,
  type VideoDocumentPromptStage,
} from '@/main/video-documents/generation-prompt-profile';
import {
  chooseDocumentProfile,
  createChapterDraftWindows,
  createVisualOnlyDraftWindows,
  lowestClassificationConfidence,
  materializeChapterPlan,
  type ChapterDraftWindow,
  type PlannedChapter,
  splitTranscriptForPlanning,
} from '@/main/video-documents/generation-orchestration';

const maximumPromptCharacters = 120_000;
const maximumStageDurationMs = 15 * 60_000;
const maximumPipelineDurationMs = 50 * 60_000;
const maximumPipelineStageCount = 64;
const maximumArticleSectionCount = 500;
const maximumKnownTotalTokens = 500_000;
const maximumModelOutputAttemptsPerStage = 2;

export interface VideoDocumentGenerationPipelineInput {
  runId: string;
  title: string;
  titleLocale: 'zh' | 'en';
  durationMs: number;
  transcript: VideoDocumentTimedTranscriptContent | null;
  evidence: VideoKeyChangeModelEvidence;
  preflightReadiness?: CodexAppServerReadiness;
  signal?: AbortSignal;
}

export interface VideoDocumentGenerationPipelineResult {
  article: VideoDocumentDraftBatch;
  actualModel: string | null;
  promptProfileId: string;
  usage: VideoDocumentTokenUsage | null;
}

interface PlannedDocument {
  chapters: PlannedChapter[];
  proposedProfiles: VideoDocumentProfile[];
}

function pipelineError(message: string) {
  return Object.assign(new Error(message), { code: 'VIDEO_DOCUMENT_MODEL_OUTPUT_INVALID' as const });
}

const failedStageUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().nullable().optional(),
    cachedInputTokens: z.number().int().nonnegative().nullable().optional(),
    outputTokens: z.number().int().nonnegative().nullable().optional(),
    reasoningOutputTokens: z.number().int().nonnegative().nullable().optional(),
    totalTokens: z.number().int().nonnegative().nullable().optional(),
  })
  .passthrough();

function failedStageUsage(error: unknown) {
  if (!error || typeof error !== 'object' || !('usage' in error)) return null;
  const parsed = failedStageUsageSchema.safeParse(error.usage);
  return parsed.success ? normalizeVideoDocumentTokenUsage(parsed.data) : null;
}

function parseStructuredMessage<T>(message: string, schema: z.ZodType<T>, resultLabel: string) {
  if (Buffer.byteLength(message, 'utf8') > 4 * 1024 * 1024) {
    throw pipelineError(`Codex returned an oversized ${resultLabel} result`);
  }
  const trimmed = message.trim();
  const withoutFence =
    trimmed.startsWith('```') && trimmed.endsWith('```')
      ? trimmed
          .slice(3, -3)
          .replace(/^json\s*/i, '')
          .trim()
      : trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence) as unknown;
  } catch {
    throw pipelineError(`Codex returned malformed ${resultLabel} JSON`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) throw pipelineError(`Codex returned an invalid ${resultLabel} structure`);
  return result.data;
}

export function normalizeVideoDocumentTokenUsage(
  usage: {
    inputTokens?: number | null;
    cachedInputTokens?: number | null;
    outputTokens?: number | null;
    reasoningOutputTokens?: number | null;
    totalTokens?: number | null;
  } | null,
): VideoDocumentTokenUsage | null {
  if (!usage || Object.values(usage).every((value) => value === undefined || value === null)) return null;
  return {
    inputTokens: usage.inputTokens ?? null,
    cachedInputTokens: usage.cachedInputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    reasoningOutputTokens: usage.reasoningOutputTokens ?? null,
    totalTokens: usage.totalTokens ?? null,
  };
}

class TokenUsageAccumulator {
  private complete = true;
  private count = 0;
  private readonly totals: VideoDocumentTokenUsage = {
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    totalTokens: null,
  };

  add(usage: VideoDocumentTokenUsage | null) {
    this.count += 1;
    if (!usage) {
      this.complete = false;
      return;
    }
    for (const key of Object.keys(this.totals) as Array<keyof VideoDocumentTokenUsage>) {
      const value = usage[key];
      if (value === null) continue;
      this.totals[key] = (this.totals[key] ?? 0) + value;
    }
  }

  result() {
    return this.count > 0 && this.complete ? this.totals : null;
  }

  knownResult() {
    return this.count > 0 && Object.values(this.totals).some((value) => value !== null) ? this.totals : null;
  }

  knownTotalTokens() {
    if (this.totals.totalTokens !== null) return this.totals.totalTokens;
    if (this.totals.inputTokens === null || this.totals.outputTokens === null) return null;
    return this.totals.inputTokens + this.totals.outputTokens;
  }
}

function assertPromptBudget(prompt: string) {
  if (prompt.length <= maximumPromptCharacters) return prompt;
  throw Object.assign(new Error('A bounded generation stage exceeded the 120,000 character prompt limit'), {
    code: 'VIDEO_DOCUMENT_TRANSCRIPT_TOO_LONG' as const,
  });
}

function validateDraftBatch(batch: VideoDocumentDraftBatch, window: ChapterDraftWindow, durationMs: number) {
  if (
    batch.documentProfile !== window.chapter.documentProfile ||
    batch.classificationConfidence !== window.chapter.classificationConfidence
  ) {
    throw pipelineError('Codex reclassified a chapter during the drafting stage');
  }
  const cueByIndex = new Map(window.primaryCues.map((cue) => [cue.sourceIndex, cue]));
  const cueIndexes = new Set(cueByIndex.keys());
  const candidateIds = new Set(window.evidence.candidates.map((candidate) => candidate.id));
  const semanticUnitIds = new Set(window.semanticUnits.map((unit) => unit.id));
  const coveredSemanticUnitIds = new Set<string>();
  let previousStart = window.startTimestampMs - 1;
  for (const section of batch.sections) {
    if (
      section.segmentType !== window.chapter.segmentType ||
      section.classificationConfidence !== window.chapter.classificationConfidence
    ) {
      throw pipelineError('Codex changed a chapter segment type during the drafting stage');
    }
    if (section.directQuoteCueIndexes.some((sourceIndex) => !cueIndexes.has(sourceIndex))) {
      throw pipelineError('Codex referenced a quotation outside its bounded primary subtitle set');
    }
    section.directQuoteCueIndexes = [...new Set(section.directQuoteCueIndexes)];
    if (
      section.startTimestampMs < previousStart ||
      section.startTimestampMs < window.startTimestampMs ||
      section.endTimestampMs < section.startTimestampMs ||
      section.endTimestampMs > Math.min(durationMs, window.endTimestampMs) + 2_000
    ) {
      throw pipelineError('Codex returned a section outside its bounded source window');
    }
    if (
      section.paragraphs.length === 0 &&
      section.steps.length === 0 &&
      section.directQuoteCueIndexes.length === 0 &&
      section.visualCandidateIds.length === 0
    ) {
      throw pipelineError('Codex returned an empty article section');
    }
    if (section.visualCandidateIds.some((candidateId) => !candidateIds.has(candidateId))) {
      throw pipelineError('Codex referenced a frame outside its bounded image set');
    }
    if (
      section.directQuoteCueIndexes.some((sourceIndex) => {
        const cue = cueByIndex.get(sourceIndex);
        return !cue || cue.endTimestampMs < section.startTimestampMs || cue.startTimestampMs > section.endTimestampMs;
      })
    ) {
      throw pipelineError('Codex referenced a quotation outside its article section');
    }
    if (section.coveredSemanticUnitIds.some((semanticUnitId) => !semanticUnitIds.has(semanticUnitId))) {
      throw pipelineError('Codex referenced an unknown semantic unit');
    }
    if (new Set(section.coveredSemanticUnitIds).size !== section.coveredSemanticUnitIds.length) {
      throw pipelineError('Codex covered one semantic unit more than once in the same section');
    }
    for (const semanticUnitId of section.coveredSemanticUnitIds) {
      if (coveredSemanticUnitIds.has(semanticUnitId)) {
        throw pipelineError('Codex covered one semantic unit in more than one section');
      }
      coveredSemanticUnitIds.add(semanticUnitId);
    }
    previousStart = section.startTimestampMs;
  }
  if (window.semanticUnits.some((unit) => !coveredSemanticUnitIds.has(unit.id))) {
    throw pipelineError('Codex omitted a necessary semantic unit');
  }
}

function validateGeneratedArticle(
  article: VideoDocumentDraftBatch,
  transcript: VideoDocumentTimedTranscriptContent | null,
  evidence: VideoKeyChangeModelEvidence,
  durationMs: number,
) {
  const cueByIndex = new Map(transcript?.cues.map((cue) => [cue.sourceIndex, cue]) ?? []);
  const cueIndexes = new Set(cueByIndex.keys());
  const candidateIds = new Set(evidence.candidates.map((candidate) => candidate.id));
  let previousStart = -1;
  for (const section of article.sections) {
    if (
      section.startTimestampMs < previousStart ||
      section.endTimestampMs < section.startTimestampMs ||
      section.endTimestampMs > durationMs + 2_000
    ) {
      throw pipelineError('Codex returned invalid article time ranges');
    }
    if (section.directQuoteCueIndexes.some((sourceIndex) => !cueIndexes.has(sourceIndex))) {
      throw pipelineError('Codex referenced an unavailable transcript cue');
    }
    if (
      section.directQuoteCueIndexes.some((sourceIndex) => {
        const cue = cueByIndex.get(sourceIndex);
        return !cue || cue.endTimestampMs < section.startTimestampMs || cue.startTimestampMs > section.endTimestampMs;
      })
    ) {
      throw pipelineError('Codex referenced a quotation outside its article section');
    }
    if (section.visualCandidateIds.some((candidateId) => !candidateIds.has(candidateId))) {
      throw pipelineError('Codex referenced an unavailable source frame');
    }
    previousStart = section.startTimestampMs;
  }
}

export class VideoDocumentGenerationPipeline {
  private readonly usage = new TokenUsageAccumulator();
  private actualModel: string | null = null;
  private deadlineMs = 0;
  private stageCount = 0;

  constructor(
    private readonly codex: CodexAdapter,
    private readonly requestedModel: string,
    private readonly checkpoints: VideoDocumentGenerationCheckpointStore | null = null,
  ) {}

  async run(input: VideoDocumentGenerationPipelineInput): Promise<VideoDocumentGenerationPipelineResult> {
    try {
      this.deadlineMs = Date.now() + maximumPipelineDurationMs;
      const transcript = input.transcript?.cues.length ? input.transcript : null;
      const planned = transcript ? await this.planDocument(input, transcript) : { chapters: [], proposedProfiles: [] };
      const windows = transcript
        ? planned.chapters.flatMap((chapter) =>
            createChapterDraftWindows({ chapter, transcriptCues: transcript.cues, evidence: input.evidence }),
          )
        : createVisualOnlyDraftWindows(input.durationMs, input.evidence);
      this.assertStageBudget(windows.length);
      const batches = await this.draftWindows(input, windows, transcript !== null);
      const sections = batches
        .flatMap((batch) => batch.sections)
        .sort(
          (left, right) =>
            left.startTimestampMs - right.startTimestampMs ||
            left.endTimestampMs - right.endTimestampMs ||
            left.heading.localeCompare(right.heading),
        );
      const documentProfile = transcript
        ? chooseDocumentProfile(planned.chapters, planned.proposedProfiles)
        : chooseDocumentProfile(
            sections.map((section) => ({
              segmentType: section.segmentType,
              startTimestampMs: section.startTimestampMs,
              endTimestampMs: section.endTimestampMs,
            })),
            batches.map((batch) => batch.documentProfile),
          );
      const confidenceValues: VideoDocumentClassificationConfidence[] = [
        ...planned.chapters.map((chapter) => chapter.classificationConfidence),
        ...batches.map((batch) => batch.classificationConfidence),
      ];
      const article: VideoDocumentDraftBatch = {
        documentProfile,
        classificationConfidence: lowestClassificationConfidence(confidenceValues),
        sections,
      };
      validateGeneratedArticle(article, transcript, input.evidence, input.durationMs);
      return {
        article,
        actualModel: this.actualModel,
        promptProfileId: VIDEO_DOCUMENT_PROMPT_PROFILE.id,
        usage: this.usage.result(),
      };
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      const failureUsage = failedStageUsage(error);
      if (failureUsage) this.usage.add(failureUsage);
      throw Object.assign(failure, {
        actualModel: this.actualModel,
        usage: this.usage.knownResult(),
      });
    }
  }

  private async planDocument(
    input: VideoDocumentGenerationPipelineInput,
    transcript: VideoDocumentTimedTranscriptContent,
  ): Promise<PlannedDocument> {
    const chapters: PlannedChapter[] = [];
    const proposedProfiles: VideoDocumentProfile[] = [];
    const planningWindows = splitTranscriptForPlanning(transcript);
    this.assertStageBudget(planningWindows.length);
    let nextChapterOrdinal = 1;
    for (const [windowIndex, cues] of planningWindows.entries()) {
      const promptStage = planningWindows.length === 1 ? 'PLAN_DOCUMENT' : 'PLAN_WINDOW';
      const startTimestampMs = cues[0]!.startTimestampMs;
      const endTimestampMs = cues.at(-1)!.endTimestampMs;
      const candidateSignals = input.evidence.candidates.filter(
        (candidate) => candidate.timestampMs >= startTimestampMs && candidate.timestampMs <= endTimestampMs,
      );
      const plan = await this.runStage(input, {
        scopeSuffix: `plan-${windowIndex + 1}`,
        promptStage,
        hasTranscript: true,
        prompt: buildVideoDocumentPlanPrompt({
          stage: promptStage,
          title: input.title,
          titleLocale: input.titleLocale,
          durationMs: input.durationMs,
          transcript: { cues },
          candidateSignals,
        }),
        localImages: [],
        visualCandidateIds: [],
        outputSchema: videoDocumentChapterPlanOutputSchema,
        resultSchema: videoDocumentChapterPlanSchema,
        resultLabel: 'chapter plan',
        validate: (value) => {
          materializeChapterPlan(value, cues, nextChapterOrdinal);
        },
      });
      const materialized = materializeChapterPlan(plan, cues, nextChapterOrdinal);
      chapters.push(...materialized);
      proposedProfiles.push(plan.documentProfile);
      nextChapterOrdinal += materialized.length;
    }
    return { chapters, proposedProfiles };
  }

  private async draftWindows(
    input: VideoDocumentGenerationPipelineInput,
    windows: readonly ChapterDraftWindow[],
    hasTranscript: boolean,
  ) {
    const batches: VideoDocumentDraftBatch[] = [];
    let sectionCount = 0;
    for (const [windowIndex, window] of windows.entries()) {
      if (sectionCount >= maximumArticleSectionCount) {
        throw pipelineError(`The article exceeded the ${maximumArticleSectionCount}-section storage limit`);
      }
      const batch = await this.runStage(input, {
        scopeSuffix: `draft-${windowIndex + 1}`,
        promptStage: 'DRAFT_CHAPTER',
        hasTranscript,
        prompt: buildVideoDocumentDraftPrompt({
          title: input.title,
          titleLocale: input.titleLocale,
          durationMs: input.durationMs,
          chapter: window.chapter,
          window,
          primaryCues: window.primaryCues,
          boundaryCues: window.boundaryCues,
          semanticUnits: window.semanticUnits,
          evidence: window.evidence,
        }),
        localImages: window.evidence.candidates.map((candidate) => candidate.filePath),
        visualCandidateIds: window.evidence.candidates.map((candidate) => candidate.id),
        outputSchema: videoDocumentDraftBatchOutputSchema,
        resultSchema: videoDocumentDraftBatchSchema,
        resultLabel: 'chapter draft',
        validate: (value) => validateDraftBatch(value, window, input.durationMs),
      });
      sectionCount += batch.sections.length;
      if (sectionCount > maximumArticleSectionCount) {
        throw pipelineError(`The article exceeded the ${maximumArticleSectionCount}-section storage limit`);
      }
      batches.push(batch);
    }
    return batches;
  }

  private async runStage<T>(
    input: VideoDocumentGenerationPipelineInput,
    stage: {
      scopeSuffix: string;
      promptStage: VideoDocumentPromptStage;
      hasTranscript: boolean;
      prompt: string;
      localImages: string[];
      visualCandidateIds: string[];
      outputSchema: Record<string, unknown>;
      resultSchema: z.ZodType<T>;
      resultLabel: string;
      validate(value: T): void;
    },
  ): Promise<T> {
    const prompt = assertPromptBudget(stage.prompt);
    const stagePromptProfile = VIDEO_DOCUMENT_PROMPT_PROFILE.stages[stage.promptStage];
    const developerInstructions = buildVideoDocumentDeveloperInstructions({
      stage: stage.promptStage,
      hasTranscript: stage.hasTranscript,
      retry: false,
    });
    const checkpointKey = this.checkpoints?.keyFor({
      promptProfileId: VIDEO_DOCUMENT_PROMPT_PROFILE.id,
      promptContractVersion: VIDEO_DOCUMENT_PROMPT_PROFILE.contractVersion,
      stagePromptProfileId: stagePromptProfile.id,
      outputSchemaVersion: stagePromptProfile.outputSchemaVersion,
      stage: stage.scopeSuffix,
      requestedModel: this.requestedModel,
      effort: 'max',
      prompt,
      developerInstructions,
      localImages: stage.localImages,
      visualCandidateIds: stage.visualCandidateIds,
      outputSchema: stage.outputSchema,
    });
    if (checkpointKey && this.checkpoints) {
      const checkpoint = await this.checkpoints.read(checkpointKey, stage.scopeSuffix, stage.resultSchema);
      if (checkpoint) {
        try {
          stage.validate(checkpoint.value);
          this.actualModel = checkpoint.actualModel;
          return checkpoint.value;
        } catch (error) {
          if (!this.isInvalidModelOutput(error)) throw error;
        }
      }
    }

    for (let attempt = 1; attempt <= maximumModelOutputAttemptsPerStage; attempt += 1) {
      this.assertStageBudget(1);
      const remainingDurationMs = this.deadlineMs - Date.now();
      if (remainingDurationMs <= 0) {
        throw Object.assign(new Error('Video document generation exceeded its total execution time limit'), {
          code: 'VIDEO_DOCUMENT_GENERATION_TIMEOUT' as const,
        });
      }
      this.stageCount += 1;
      const attemptDeveloperInstructions = buildVideoDocumentDeveloperInstructions({
        stage: stage.promptStage,
        hasTranscript: stage.hasTranscript,
        retry: attempt > 1,
      });
      const result = await this.codex.runStructuredText(
        {
          scopeId: `video-document-generation:${input.runId}:${stage.scopeSuffix}:attempt-${attempt}`,
          title: input.title,
          prompt,
          developerInstructions: attemptDeveloperInstructions,
          model: this.requestedModel,
          effort: 'max',
          localImages: stage.localImages,
          outputSchema: stage.outputSchema,
          timeoutMs: Math.min(maximumStageDurationMs, remainingDurationMs),
        },
        input.signal,
        { trackPending: false, preflightReadiness: input.preflightReadiness },
      );
      this.actualModel = result.actualModel;
      this.usage.add(normalizeVideoDocumentTokenUsage(result.usage));
      const knownTotalTokens = this.usage.knownTotalTokens();
      if (knownTotalTokens !== null && knownTotalTokens > maximumKnownTotalTokens) {
        throw Object.assign(new Error('Video document generation exceeded its total token budget'), {
          code: 'VIDEO_DOCUMENT_GENERATION_BUDGET_EXCEEDED' as const,
        });
      }
      try {
        const value = parseStructuredMessage(result.finalMessage, stage.resultSchema, stage.resultLabel);
        stage.validate(value);
        if (checkpointKey && this.checkpoints) {
          await this.checkpoints.write(
            checkpointKey,
            stage.scopeSuffix,
            result.actualModel,
            stage.visualCandidateIds,
            value,
            stage.resultSchema,
          );
        }
        return value;
      } catch (error) {
        if (attempt === maximumModelOutputAttemptsPerStage || !this.isInvalidModelOutput(error)) throw error;
      }
    }
    throw pipelineError(`Codex did not return a valid ${stage.resultLabel}`);
  }

  private isInvalidModelOutput(error: unknown) {
    return Boolean(
      error && typeof error === 'object' && 'code' in error && error.code === 'VIDEO_DOCUMENT_MODEL_OUTPUT_INVALID',
    );
  }

  private assertStageBudget(additionalStageCount: number) {
    if (this.stageCount + additionalStageCount <= maximumPipelineStageCount) return;
    throw Object.assign(
      new Error(`Video document generation requires more than ${maximumPipelineStageCount} bounded model stages`),
      { code: 'VIDEO_DOCUMENT_GENERATION_BUDGET_EXCEEDED' as const },
    );
  }
}
