import type {
  AssistantRunDto,
  BootstrapDto,
  GenerationRunDto,
  PromptSeriesDto,
  PromptVersionDto,
  StyleExplorationBatchDto,
} from '@/shared/contracts';
import type { VideoDocumentAiActivityDto } from '@/shared/contracts/video-document-ai-activity';

interface ActivityBase {
  id: string;
  createdAt: string;
  sourceSeries: PromptSeriesDto | null;
}

export interface AssistantActivityRecord extends ActivityBase {
  kind: 'ASSISTANT';
  run: AssistantRunDto;
  ordinal: number;
  occurrenceCount: number;
}

export interface ExperimentActivityRecord extends ActivityBase {
  kind: 'EXPERIMENT';
  batch: StyleExplorationBatchDto;
  sourceRun: AssistantRunDto | null;
}

export interface GenerationActivityRecord extends ActivityBase {
  kind: 'GENERATION';
  run: GenerationRunDto;
  version: PromptVersionDto;
  operation: 'GENERATE' | 'EDIT';
}

export interface VideoDocumentActivityRecord extends ActivityBase {
  kind: 'VIDEO_DOCUMENT';
  activity: VideoDocumentAiActivityDto;
}

export type AiActivityRecord =
  AssistantActivityRecord | ExperimentActivityRecord | GenerationActivityRecord | VideoDocumentActivityRecord;

export type AiActivityDomain = 'IMAGE' | 'TEXT' | 'DOCUMENT';
export type AiActivityCategory =
  'DIRECTIONS' | 'OPTIMIZE' | 'EXPERIMENT' | 'GENERATE' | 'EDIT' | 'VIDEO_ARTICLE' | 'TRANSCRIBE' | 'TRANSLATE';
export type AiActivityCategoryFilter = 'ALL' | AiActivityDomain | AiActivityCategory;

export type AiActivityStatusFilter = 'ALL' | 'ATTENTION' | 'RUNNING' | 'COMPLETED' | 'EXPIRED';

export interface AiActivityDuration {
  milliseconds: number;
  running: boolean;
}

function generationOperation(run: GenerationRunDto, version: PromptVersionDto): GenerationActivityRecord['operation'] {
  const actualRequest = run.executionInputSnapshot?.actualRequest;
  const operation = actualRequest && !Array.isArray(actualRequest) ? actualRequest.operation : undefined;
  if (operation === 'EDIT') return 'EDIT';
  if (operation === 'GENERATE') return 'GENERATE';
  return version.sourceImageId || run.derivation ? 'EDIT' : 'GENERATE';
}

export function projectAiActivities(
  data: BootstrapDto,
  videoDocumentActivities: VideoDocumentAiActivityDto[] = [],
): AiActivityRecord[] {
  const seriesById = new Map(data.series.map((series) => [series.id, series]));
  const assistantById = new Map(data.assistantRuns.map((run) => [run.id, run]));
  const experimentRunIds = new Set(
    data.styleExplorationBatches.flatMap((batch) => batch.slots.flatMap((slot) => slot.runIds)),
  );
  const assistantRecords = data.assistantRuns.map((run): AssistantActivityRecord => ({
    id: `assistant:${run.id}`,
    kind: 'ASSISTANT',
    createdAt: run.createdAt,
    sourceSeries: run.scope.kind === 'SERIES' ? (seriesById.get(run.scope.id) ?? null) : null,
    run,
    ordinal: run.occurrenceNo ?? 1,
    occurrenceCount: run.occurrenceCount ?? 1,
  }));

  const experimentRecords = data.styleExplorationBatches.map((batch): ExperimentActivityRecord => {
    const sourceRun = assistantById.get(batch.sourceAssistantRunId) ?? null;
    return {
      id: `experiment:${batch.id}`,
      kind: 'EXPERIMENT',
      createdAt: batch.createdAt,
      sourceSeries: batch.scope.kind === 'SERIES' ? (seriesById.get(batch.scope.id) ?? null) : null,
      batch,
      sourceRun,
    };
  });

  const generationRecords = data.series.flatMap((series) =>
    series.versions.flatMap((version) =>
      version.runs.flatMap((run): GenerationActivityRecord[] =>
        experimentRunIds.has(run.id)
          ? []
          : [
              {
                id: `generation:${run.id}`,
                kind: 'GENERATION',
                createdAt: run.createdAt,
                sourceSeries: series,
                run,
                version,
                operation: generationOperation(run, version),
              },
            ],
      ),
    ),
  );

  const videoDocumentRecords = videoDocumentActivities.map((activity): VideoDocumentActivityRecord => ({
    id: `video-document:${activity.type}:${activity.run.id}`,
    kind: 'VIDEO_DOCUMENT',
    createdAt: activity.run.startedAt,
    sourceSeries: null,
    activity,
  }));

  return [...assistantRecords, ...experimentRecords, ...generationRecords, ...videoDocumentRecords].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );
}

export function activityCategory(record: AiActivityRecord): AiActivityCategory {
  if (record.kind === 'ASSISTANT') return record.run.mode === 'directions' ? 'DIRECTIONS' : 'OPTIMIZE';
  if (record.kind === 'EXPERIMENT') return 'EXPERIMENT';
  if (record.kind === 'VIDEO_DOCUMENT') {
    if (record.activity.type === 'ARTICLE_GENERATION') return 'VIDEO_ARTICLE';
    return record.activity.type === 'TRANSCRIPT_RECOGNITION' ? 'TRANSCRIBE' : 'TRANSLATE';
  }
  return record.operation;
}

export function activityDomain(record: AiActivityRecord): AiActivityDomain {
  if (record.kind === 'VIDEO_DOCUMENT') return 'DOCUMENT';
  return record.kind === 'ASSISTANT' ? 'TEXT' : 'IMAGE';
}

export function activityStatusFilter(record: AiActivityRecord): Exclude<AiActivityStatusFilter, 'ALL'> {
  if (record.kind === 'ASSISTANT') {
    if (record.run.status === 'RUNNING') return 'RUNNING';
    if (record.run.proposal?.status === 'EXPIRED') return 'EXPIRED';
    if (record.run.status === 'FAILED' || record.run.status === 'INTERRUPTED') return 'ATTENTION';
    return 'COMPLETED';
  }
  if (record.kind === 'EXPERIMENT') {
    if (record.batch.activeCount > 0 || record.batch.status === 'QUEUED' || record.batch.status === 'RUNNING')
      return 'RUNNING';
    if (['FAILED', 'INTERRUPTED', 'PARTIAL'].includes(record.batch.status)) return 'ATTENTION';
    return 'COMPLETED';
  }
  if (record.kind === 'VIDEO_DOCUMENT') {
    if (record.activity.run.status === 'RUNNING') return 'RUNNING';
    if (record.activity.run.status !== 'SUCCEEDED') return 'ATTENTION';
    return 'COMPLETED';
  }
  if (record.run.status === 'QUEUED' || record.run.status === 'RUNNING') return 'RUNNING';
  if (record.run.status === 'FAILED' || record.run.status === 'INTERRUPTED') return 'ATTENTION';
  return 'COMPLETED';
}

export function activityMatchesFilters(
  record: AiActivityRecord,
  category: AiActivityCategoryFilter,
  status: AiActivityStatusFilter,
) {
  return (
    (category === 'ALL' ||
      (category === 'IMAGE' || category === 'TEXT' || category === 'DOCUMENT'
        ? activityDomain(record) === category
        : activityCategory(record) === category)) &&
    (status === 'ALL' || activityStatusFilter(record) === status)
  );
}

export function activityDuration(record: AiActivityRecord, now = Date.now()): AiActivityDuration | null {
  const running = activityStatusFilter(record) === 'RUNNING';
  const startValue =
    record.kind === 'ASSISTANT'
      ? record.run.createdAt
      : record.kind === 'EXPERIMENT'
        ? record.batch.createdAt
        : record.kind === 'VIDEO_DOCUMENT'
          ? record.activity.run.startedAt
          : record.run.createdAt;
  const endValue = running
    ? now
    : record.kind === 'ASSISTANT'
      ? record.run.finishedAt
      : record.kind === 'EXPERIMENT'
        ? record.batch.updatedAt
        : record.kind === 'VIDEO_DOCUMENT'
          ? record.activity.run.finishedAt
          : record.run.finishedAt;
  const start = Date.parse(startValue);
  const end = typeof endValue === 'number' ? endValue : endValue ? Date.parse(endValue) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { milliseconds: end - start, running };
}

export function activityStatus(record: AiActivityRecord) {
  if (record.kind === 'ASSISTANT') {
    return record.run.status === 'SUCCEEDED' && record.run.proposal ? record.run.proposal.status : record.run.status;
  }
  if (record.kind === 'EXPERIMENT') return record.batch.status;
  return record.kind === 'VIDEO_DOCUMENT' ? record.activity.run.status : record.run.status;
}

export function findGenerationAssetId(record: GenerationActivityRecord) {
  return record.run.asset?.id ?? null;
}
