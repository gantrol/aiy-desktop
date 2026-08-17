import { z } from 'zod';
import type {
  VideoDocumentArticleGenerateResult,
  VideoDocumentBranchDto,
  VideoDocumentDto,
  VideoDocumentRevisionContent,
  VideoDocumentRichNote,
  VideoDocumentTimelineSegment,
  VideoDocumentTimedTranscriptContent,
} from '@/shared/contracts';
import type { CodexAdapter } from '@/main/assistant/codex';
import type { LibraryDatabase } from '@/main/database';
import { VideoKeyChangeService, type VideoKeyChangeModelEvidence } from '@/main/video-documents/key-change-service';
import { VideoDocumentGenerationCheckpointStore } from '@/main/video-documents/generation-checkpoint-store';
import { formatVideoDocumentTimestamp, type VideoDocumentDraftBatch } from '@/main/video-documents/generation-profile';
import {
  normalizeVideoDocumentTokenUsage,
  VideoDocumentGenerationPipeline,
} from '@/main/video-documents/generation-pipeline';

const requestedModel = 'gpt-5.6-luna';
const maximumMarkdownCharacters = 500_000;
const DEFAULT_NOTE_ID = 'default';

type GeneratedArticle = VideoDocumentDraftBatch;
const formatTimestamp = formatVideoDocumentTimestamp;

function errorWithCode(code: string, message: string, options: { retryable?: boolean; resetAt?: string | null } = {}) {
  return Object.assign(new Error(message), { code, ...options });
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
  const resetAt = readiness.resetAt === null ? null : new Date(readiness.resetAt * 1_000).toISOString();
  return errorWithCode(code, readiness.diagnostics.map((diagnostic) => diagnostic.code).join(', ') || code, {
    retryable: readiness.retryable,
    resetAt,
  });
}

function timeLink(timestampMs: number) {
  return `[${formatTimestamp(timestampMs)}](#t=${Math.max(0, Math.floor(timestampMs / 1_000))})`;
}

function plainMarkdown(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/([\\`*_[\]<>#|])/g, '\\$1');
}

function quotedMarkdown(value: string) {
  return value
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

const providerUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().nullable().optional(),
    cachedInputTokens: z.number().int().nonnegative().nullable().optional(),
    outputTokens: z.number().int().nonnegative().nullable().optional(),
    reasoningOutputTokens: z.number().int().nonnegative().nullable().optional(),
    totalTokens: z.number().int().nonnegative().nullable().optional(),
  })
  .passthrough();

function usageFromError(error: unknown) {
  if (!error || typeof error !== 'object' || !('usage' in error)) return null;
  const parsed = providerUsageSchema.safeParse(error.usage);
  return parsed.success ? normalizeVideoDocumentTokenUsage(parsed.data) : null;
}

function actualModelFromError(error: unknown) {
  if (!error || typeof error !== 'object' || !('actualModel' in error)) return null;
  return typeof error.actualModel === 'string' && error.actualModel ? error.actualModel : null;
}

function transcriptCueIntervalIndex(transcript: VideoDocumentTimedTranscriptContent | null) {
  const cues = transcript?.cues ?? [];
  let maximumEndTimestampMs = -1;
  return {
    cues,
    maximumEndTimestamps: cues.map((cue) => {
      maximumEndTimestampMs = Math.max(maximumEndTimestampMs, cue.endTimestampMs);
      return maximumEndTimestampMs;
    }),
  };
}

function overlappingTranscriptCues(
  index: ReturnType<typeof transcriptCueIntervalIndex>,
  startTimestampMs: number,
  endTimestampMs: number,
) {
  let low = 0;
  let high = index.cues.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (index.cues[middle]!.startTimestampMs <= endTimestampMs) low = middle + 1;
    else high = middle;
  }
  const end = low;
  low = 0;
  high = end;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (index.maximumEndTimestamps[middle]! >= startTimestampMs) high = middle;
    else low = middle + 1;
  }
  const result: VideoDocumentTimedTranscriptContent['cues'] = [];
  for (let cueIndex = low; cueIndex < end; cueIndex += 1) {
    const cue = index.cues[cueIndex]!;
    if (cue.endTimestampMs >= startTimestampMs) result.push(cue);
  }
  return result;
}

function renderMarkdown(input: {
  title: string;
  titleLocale: 'zh' | 'en';
  article: GeneratedArticle;
  transcript: VideoDocumentTimedTranscriptContent | null;
  evidence: VideoKeyChangeModelEvidence;
  selectedCandidateIds: ReadonlySet<string>;
}) {
  const cueByIndex = new Map(input.transcript?.cues.map((cue) => [cue.sourceIndex, cue]) ?? []);
  const cueIntervalIndex = transcriptCueIntervalIndex(input.transcript);
  const candidateById = new Map(input.evidence.candidates.map((candidate) => [candidate.id, candidate]));
  const indexTitle = input.titleLocale === 'zh' ? '时间索引' : 'Time index';
  const contentLabel = input.titleLocale === 'zh' ? '内容' : 'Section';
  const sourceTimeLabel = input.titleLocale === 'zh' ? '原视频时间' : 'Source time';
  const markdown: string[] = [];
  let markdownCharacters = 0;
  const push = (...chunks: string[]) => {
    for (const chunk of chunks) {
      markdownCharacters += chunk.length + (markdown.length ? 1 : 0);
      if (markdownCharacters >= maximumMarkdownCharacters) {
        throw errorWithCode('VIDEO_DOCUMENT_MODEL_OUTPUT_INVALID', 'The generated article exceeds the storage limit');
      }
      markdown.push(chunk);
    }
  };
  push(
    `# ${plainMarkdown(input.title)}`,
    '',
    `## ${indexTitle}`,
    '',
    `| ${contentLabel} | ${sourceTimeLabel} |`,
    '| --- | --- |',
  );
  for (const section of input.article.sections) {
    const heading =
      section.classificationConfidence === 'LOW'
        ? `${formatTimestamp(section.startTimestampMs)}–${formatTimestamp(section.endTimestampMs)}`
        : section.heading;
    push(`| ${plainMarkdown(heading)} | ${timeLink(section.startTimestampMs)}-${timeLink(section.endTimestampMs)} |`);
  }
  for (const section of input.article.sections) {
    const heading =
      section.classificationConfidence === 'LOW'
        ? `${formatTimestamp(section.startTimestampMs)}–${formatTimestamp(section.endTimestampMs)}`
        : section.heading;
    push(
      '',
      `## ${plainMarkdown(heading)} ${timeLink(section.startTimestampMs)}-${timeLink(section.endTimestampMs)}`,
      '',
    );
    const originalLed =
      Boolean(input.transcript) &&
      (section.classificationConfidence === 'LOW' || section.segmentType === 'ORIGINAL_LED');
    if (originalLed) {
      for (const cue of overlappingTranscriptCues(cueIntervalIndex, section.startTimestampMs, section.endTimestampMs)) {
        push(`> ${timeLink(cue.startTimestampMs)} ${cue.text.trim()}`, '');
      }
    } else {
      for (const paragraph of section.paragraphs) push(plainMarkdown(paragraph), '');
      if (section.steps.length) {
        section.steps.forEach((step, index) => push(`${index + 1}. ${plainMarkdown(step)}`));
        push('');
      }
      for (const sourceIndex of section.directQuoteCueIndexes) {
        const cue = cueByIndex.get(sourceIndex);
        if (cue) push(quotedMarkdown(cue.text), '');
      }
    }
    for (const candidateId of section.visualCandidateIds) {
      const candidate = candidateById.get(candidateId);
      if (!candidate || !input.selectedCandidateIds.has(candidateId)) continue;
      const path = `assets/${candidateId}.jpg`;
      push(`![${plainMarkdown(heading)} ${formatTimestamp(candidate.timestampMs)}](${path})`, '');
    }
  }
  return `${markdown.join('\n').trim()}\n`;
}

function timelineSegments(
  article: GeneratedArticle,
  transcript: VideoDocumentTimedTranscriptContent | null,
): VideoDocumentTimelineSegment[] {
  const cueIntervalIndex = transcriptCueIntervalIndex(transcript);
  return article.sections.map((section, index) => {
    const cues = overlappingTranscriptCues(cueIntervalIndex, section.startTimestampMs, section.endTimestampMs);
    const confidence =
      section.classificationConfidence === 'HIGH' ? 0.9 : section.classificationConfidence === 'MEDIUM' ? 0.65 : 0.35;
    return {
      id: `segment-${index + 1}-${section.startTimestampMs}`,
      title:
        section.classificationConfidence === 'LOW'
          ? `${formatTimestamp(section.startTimestampMs)}–${formatTimestamp(section.endTimestampMs)}`
          : section.heading,
      segmentType: section.classificationConfidence === 'LOW' ? 'ORIGINAL_LED' : section.segmentType,
      startTimestampMs: section.startTimestampMs,
      endTimestampMs: section.endTimestampMs,
      confidence,
      startCueSourceIndex: cues[0]?.sourceIndex ?? null,
      endCueSourceIndex: cues.at(-1)?.sourceIndex ?? null,
      directQuoteCueSourceIndexes: section.directQuoteCueIndexes,
    };
  });
}

function latestBranchRevision(database: LibraryDatabase, branchId: string) {
  return database.getLatestVideoDocumentRevision(branchId);
}

type NoteCollectionContent = Extract<VideoDocumentRevisionContent, { format: 'NOTE_COLLECTION' }>;
type MarkdownContent = Extract<VideoDocumentRevisionContent, { format: 'MARKDOWN' }>;

function generationNoteTarget(
  articleParent: ReturnType<typeof latestBranchRevision>,
  noteId: string | null | undefined,
) {
  if (articleParent?.content.format !== 'NOTE_COLLECTION') {
    return { parentCollection: null, targetNote: null };
  }
  const parentCollection = articleParent.content;
  const targetNote = parentCollection.notes.find((note) => note.id === (noteId ?? parentCollection.defaultNoteId));
  if (!targetNote) throw errorWithCode('VIDEO_DOCUMENT_NOTE_UNAVAILABLE', 'The selected note is unavailable');
  return { parentCollection, targetNote };
}

function mergeGeneratedNote(
  parentCollection: NoteCollectionContent | null,
  targetNote: VideoDocumentRichNote | null,
  generatedContent: MarkdownContent,
  finishedAt: string,
): VideoDocumentRevisionContent {
  if (!parentCollection || !targetNote) return generatedContent;
  const replacement: VideoDocumentRichNote = {
    ...targetNote,
    markdown: generatedContent.markdown,
    transcriptBasis: generatedContent.transcriptBasis,
    sourceUrl: generatedContent.sourceUrl,
    generation: generatedContent.generation,
    mediaBindings: generatedContent.mediaBindings,
    timelineSegments: generatedContent.timelineSegments,
    updatedAt: finishedAt,
  };
  return {
    ...parentCollection,
    notes: parentCollection.notes.map((note) => (note.id === replacement.id ? replacement : note)),
  };
}

async function prepareGenerationCheckpoints(
  database: LibraryDatabase,
  documentId: string,
  checkpointStore: VideoDocumentGenerationCheckpointStore,
) {
  const latestFinishedGeneration = database
    .listVideoDocumentGenerationRuns({ documentId, limit: 50 })
    .items.find((candidate) => candidate.status !== 'BLOCKED' && candidate.status !== 'NOT_STARTED');
  if (
    latestFinishedGeneration &&
    ['RUNNING', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(latestFinishedGeneration.status)
  ) {
    return true;
  }
  return checkpointStore.clear();
}

function latestTranscriptInput(database: LibraryDatabase, branch: VideoDocumentBranchDto | undefined) {
  const expectedRevisionId = branch?.latestDraftRevisionId;
  if (!branch || !expectedRevisionId) return null;
  const revision = latestBranchRevision(database, branch.id);
  if (!revision || revision.id !== expectedRevisionId || revision.content.format !== 'TIMED_TRANSCRIPT') {
    throw errorWithCode(
      'VIDEO_DOCUMENT_GENERATION_INPUT_UNAVAILABLE',
      'The current transcript revision is unavailable',
    );
  }
  return { revision, transcript: revision.content };
}

function assertTranscriptInputUnchanged(
  database: LibraryDatabase,
  documentId: string,
  expectedRevisionId: string | null,
) {
  const currentDocument = database.getVideoDocument(documentId);
  const currentTranscriptBranch = currentDocument.branches.find((branch) => branch.role === 'CLEAN_TRANSCRIPT');
  if ((currentTranscriptBranch?.latestDraftRevisionId ?? null) !== expectedRevisionId) {
    throw errorWithCode('VIDEO_DOCUMENT_GENERATION_INPUT_CHANGED', 'Transcript changed during generation');
  }
}

function assertArticleParentUnchanged(database: LibraryDatabase, branchId: string, expectedRevisionId: string | null) {
  if ((latestBranchRevision(database, branchId)?.id ?? null) !== expectedRevisionId) {
    throw errorWithCode('VIDEO_DOCUMENT_GENERATION_INPUT_CHANGED', 'Article changed during generation');
  }
}

interface VideoDocumentSourceSnapshot {
  materialId: string;
  assetId: string;
  objectHash: string;
  byteSize: number | undefined;
}

function captureVideoDocumentSource(
  database: LibraryDatabase,
  document: VideoDocumentDto,
): VideoDocumentSourceSnapshot {
  if (!document.source.available) {
    throw errorWithCode('VIDEO_DOCUMENT_GENERATION_INPUT_UNAVAILABLE', 'The source video is unavailable');
  }
  const source = database.resolveAssetFile(document.source.asset.id);
  if (!source || !source.mimeType.startsWith('video/')) {
    throw errorWithCode('VIDEO_DOCUMENT_GENERATION_INPUT_UNAVAILABLE', 'The source video is unavailable');
  }
  return {
    materialId: document.source.materialId,
    assetId: document.source.asset.id,
    objectHash: source.objectHash,
    byteSize: document.source.asset.byteSize,
  };
}

function assertVideoDocumentSourceUnchanged(
  database: LibraryDatabase,
  documentId: string,
  expected: VideoDocumentSourceSnapshot,
) {
  const current = database.getVideoDocument(documentId);
  const source = current.source.available ? database.resolveAssetFile(current.source.asset.id) : null;
  if (
    current.source.materialId !== expected.materialId ||
    current.source.asset.id !== expected.assetId ||
    current.source.asset.byteSize !== expected.byteSize ||
    !source ||
    source.objectHash !== expected.objectHash
  ) {
    throw errorWithCode('VIDEO_DOCUMENT_GENERATION_INPUT_CHANGED', 'Source video changed during generation');
  }
}

function assertEvidenceMatchesSource(evidence: VideoKeyChangeModelEvidence, expected: VideoDocumentSourceSnapshot) {
  if (evidence.sourceAssetId !== expected.assetId || evidence.sourceObjectHash !== expected.objectHash) {
    throw errorWithCode('VIDEO_DOCUMENT_GENERATION_INPUT_CHANGED', 'Source video changed during evidence extraction');
  }
}

async function ensureEvidenceImages(input: {
  database: LibraryDatabase;
  documentId: string;
  selectedCandidateIds: readonly string[];
  evidence: VideoKeyChangeModelEvidence;
}) {
  const candidateById = new Map(input.evidence.candidates.map((candidate) => [candidate.id, candidate]));
  const assetIdByCandidateId = new Map<string, string>();
  for (const candidateId of input.selectedCandidateIds) {
    const candidate = candidateById.get(candidateId)!;
    const assetId = await input.database.ensurePrivateVideoDocumentEvidenceImage({
      documentId: input.documentId,
      candidateId,
      sourcePath: candidate.filePath,
    });
    assetIdByCandidateId.set(candidateId, assetId);
  }
  const thumbnailCandidateId = input.selectedCandidateIds[0] ?? input.evidence.candidates[0]?.id;
  let thumbnailAssetId = thumbnailCandidateId ? assetIdByCandidateId.get(thumbnailCandidateId) : undefined;
  if (thumbnailCandidateId && !thumbnailAssetId) {
    const candidate = candidateById.get(thumbnailCandidateId)!;
    thumbnailAssetId = await input.database.ensurePrivateVideoDocumentEvidenceImage({
      documentId: input.documentId,
      candidateId: thumbnailCandidateId,
      sourcePath: candidate.filePath,
    });
  }
  return { assetIdByCandidateId, candidateById, thumbnailAssetId };
}

async function prepareGenerationInputs(input: {
  database: LibraryDatabase;
  codex: CodexAdapter;
  keyChanges: VideoKeyChangeService;
  document: VideoDocumentDto;
  documentId: string;
  signal?: AbortSignal;
}) {
  let sourceSnapshot: VideoDocumentSourceSnapshot;
  try {
    sourceSnapshot = captureVideoDocumentSource(input.database, input.document);
  } catch (error) {
    return { ready: false as const, status: 'NOT_STARTED' as const, error };
  }
  let readiness: Awaited<ReturnType<CodexAdapter['preflightStructuredText']>>;
  try {
    readiness = await input.codex.preflightStructuredText({ model: requestedModel, effort: 'max' }, input.signal);
  } catch (error) {
    return { ready: false as const, status: 'NOT_STARTED' as const, error };
  }
  if (!readiness.canStartTurn) {
    return { ready: false as const, status: 'BLOCKED' as const, error: preflightError(readiness) };
  }
  try {
    assertVideoDocumentSourceUnchanged(input.database, input.documentId, sourceSnapshot);
    const evidence = await input.keyChanges.allModelEvidence(input.documentId, input.signal);
    assertEvidenceMatchesSource(evidence, sourceSnapshot);
    assertVideoDocumentSourceUnchanged(input.database, input.documentId, sourceSnapshot);
    return { ready: true as const, sourceSnapshot, readiness, evidence };
  } catch (error) {
    return { ready: false as const, status: 'NOT_STARTED' as const, error };
  }
}

export class VideoDocumentGenerationService {
  private readonly keyChanges: VideoKeyChangeService;

  constructor(
    private readonly database: LibraryDatabase,
    private readonly codex: CodexAdapter,
  ) {
    this.keyChanges = new VideoKeyChangeService(database);
  }

  async generateArticle(
    documentId: string,
    noteId: string | null | undefined,
    signal?: AbortSignal,
  ): Promise<VideoDocumentArticleGenerateResult> {
    const document = this.database.getVideoDocument(documentId);
    const transcriptBranch = document.branches.find((branch) => branch.role === 'CLEAN_TRANSCRIPT');
    const articleBranch = document.branches.find((branch) => branch.role === 'ARTICLE');
    if (!articleBranch) throw errorWithCode('VIDEO_DOCUMENT_ARTICLE_BRANCH_MISSING', 'Article branch is unavailable');
    const stopped = (status: 'BLOCKED' | 'NOT_STARTED', reason: unknown, inputRevisionId: string | null) => ({
      run: this.database.recordStoppedVideoDocumentArticleGeneration({
        documentId,
        branchId: articleBranch.id,
        inputRevisionId,
        requestedModel,
        status,
        reason,
      }),
      revision: null,
    });
    let transcriptInput: ReturnType<typeof latestTranscriptInput>;
    try {
      transcriptInput = latestTranscriptInput(this.database, transcriptBranch);
    } catch (error) {
      return stopped('NOT_STARTED', error, null);
    }
    const transcriptRevision = transcriptInput?.revision ?? null;
    const transcript = transcriptInput?.transcript ?? null;
    const inputRevisionId = transcriptRevision?.id ?? null;
    const articleParent = latestBranchRevision(this.database, articleBranch.id);
    let noteTarget: ReturnType<typeof generationNoteTarget>;
    try {
      noteTarget = generationNoteTarget(articleParent, noteId);
    } catch (error) {
      return stopped('NOT_STARTED', error, inputRevisionId);
    }
    const { parentCollection, targetNote } = noteTarget;
    const checkpointStore = new VideoDocumentGenerationCheckpointStore(
      this.database.libraryRoot,
      `${documentId}:${targetNote?.id ?? DEFAULT_NOTE_ID}`,
    );
    const checkpointsReady = await prepareGenerationCheckpoints(this.database, documentId, checkpointStore);
    const preparation = await prepareGenerationInputs({
      database: this.database,
      codex: this.codex,
      keyChanges: this.keyChanges,
      document,
      documentId,
      signal,
    });
    if (!preparation.ready) return stopped(preparation.status, preparation.error, inputRevisionId);
    const { sourceSnapshot, readiness, evidence } = preparation;
    const run = this.database.startVideoDocumentArticleGeneration({
      documentId,
      branchId: articleBranch.id,
      inputRevisionId,
      requestedModel,
    });
    let actualModel: string | null = null;
    const usableTranscript = transcript?.cues.length ? transcript : null;
    try {
      const generated = await new VideoDocumentGenerationPipeline(
        this.codex,
        requestedModel,
        checkpointsReady ? checkpointStore : null,
      ).run({
        runId: run.id,
        title: targetNote?.title ?? document.title,
        titleLocale: document.titleLocale,
        durationMs: document.source.asset.durationMs,
        transcript: usableTranscript,
        evidence,
        preflightReadiness: readiness,
        signal,
      });
      actualModel = generated.actualModel;
      const article = generated.article;
      const usage = generated.usage;
      assertTranscriptInputUnchanged(this.database, documentId, inputRevisionId);
      assertArticleParentUnchanged(this.database, articleBranch.id, articleParent?.id ?? null);
      assertVideoDocumentSourceUnchanged(this.database, documentId, sourceSnapshot);
      const selectedIds = [...new Set(article.sections.flatMap((section) => section.visualCandidateIds))];
      const selectedCandidateIds = new Set(selectedIds);
      const markdown = renderMarkdown({
        title: document.title,
        titleLocale: document.titleLocale,
        article,
        transcript: usableTranscript,
        evidence,
        selectedCandidateIds,
      });
      const { assetIdByCandidateId, candidateById, thumbnailAssetId } = await ensureEvidenceImages({
        database: this.database,
        documentId,
        selectedCandidateIds: selectedIds,
        evidence,
      });
      assertTranscriptInputUnchanged(this.database, documentId, inputRevisionId);
      assertArticleParentUnchanged(this.database, articleBranch.id, articleParent?.id ?? null);
      assertVideoDocumentSourceUnchanged(this.database, documentId, sourceSnapshot);
      const finishedAt = new Date().toISOString();
      const mediaBindings = selectedIds.map((candidateId) => {
        const candidate = candidateById.get(candidateId)!;
        return {
          path: `assets/${candidateId}.jpg`,
          assetId: assetIdByCandidateId.get(candidateId)!,
          kind: 'IMAGE' as const,
          timestampMs: candidate.timestampMs,
          endTimestampMs: null,
          posterAssetId: null,
        };
      });
      const generatedContent: MarkdownContent = {
        schemaVersion: 1,
        format: 'MARKDOWN',
        markdown,
        transcriptBasis: usableTranscript?.transcriptBasis ?? 'NONE',
        sourceUrl: document.source.sourceUrl,
        generation: {
          runId: run.id,
          providerKey: 'codex',
          requestedModel,
          actualModel,
          reasoningEffort: 'max',
          promptProfileId: generated.promptProfileId,
          transcriptRevisionId: inputRevisionId,
          usageAvailability: usage ? 'PROVIDED' : 'MISSING',
          usage,
          startedAt: run.startedAt,
          finishedAt,
        },
        mediaBindings,
        timelineSegments: timelineSegments(article, usableTranscript),
      };
      const content = mergeGeneratedNote(parentCollection, targetNote, generatedContent, finishedAt);
      const committed = this.database.commitVideoDocumentArticleGeneration({
        documentId,
        thumbnailAssetId: thumbnailAssetId ?? null,
        revision: {
          branchId: articleBranch.id,
          expectedParentRevisionId: articleParent?.id ?? null,
          content,
        },
        completion: {
          runId: run.id,
          actualModel,
          usage,
          finishedAt,
        },
      });
      await checkpointStore.clear();
      return committed;
    } catch (error) {
      actualModel = actualModelFromError(error) ?? actualModel;
      const failed = this.database.failVideoDocumentArticleGeneration(run.id, error, {
        actualModel,
        usage: usageFromError(error),
      });
      return { run: failed, revision: null };
    }
  }
}
