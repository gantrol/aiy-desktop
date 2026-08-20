import { z } from 'zod';
import type {
  AssistantActivityEventDto,
  BootstrapDto,
  GenerationProcessEventHeaderDto,
  GenerationProcessSummaryDto,
  GenerationRunDto,
} from '@/shared/contracts';
import type { MessageCatalog } from '@/renderer/i18n/types';
import type {
  AiActivityRecord,
  AssistantActivityRecord,
  ExperimentActivityRecord,
  GenerationActivityRecord,
  VideoDocumentActivityRecord,
} from '@/renderer/features/ai-center/activityProjection';

export type AiActivityTraceLane = 'INPUT' | 'MODEL' | 'PROCESS';
export type AiActivityTraceResolution = 'EVENTS' | 'SUMMARY';

export interface AiActivityTraceEntry {
  id: string;
  sequence: number;
  lane: AiActivityTraceLane;
  label: string;
  details: string[];
  startedAt: string;
  endedAt: string | null;
  point: boolean;
  call: boolean;
}

export interface AiActivityTraceProjection {
  entries: AiActivityTraceEntry[];
  resolution: AiActivityTraceResolution;
}

type AiCenterLabels = MessageCatalog['aiCenter'];
type TraceLabels = AiCenterLabels['trace'];

const assistantUsagePayloadSchema = z
  .object({
    usage: z
      .object({
        promptTokens: z.number().int().nonnegative(),
        completionTokens: z.number().int().nonnegative(),
        totalTokens: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .passthrough();

function parseTimestamp(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function modelName(run: GenerationRunDto, data: BootstrapDto) {
  return (
    run.modelSnapshot?.descriptor.name ??
    data.imageGenerationRoutes.find((candidate) => candidate.key === run.modelKey)?.name ??
    run.modelKey
  );
}

function providerName(run: GenerationRunDto, data: BootstrapDto) {
  return (
    run.modelSnapshot?.descriptor.provider ??
    data.imageGenerationRoutes.find((candidate) => candidate.key === run.modelKey)?.provider ??
    null
  );
}

function statusLabel(status: string, labels: AiCenterLabels) {
  return (labels.statuses as Record<string, string>)[status] ?? status;
}

function field(label: string, value: string | number | null | undefined) {
  return value === null || value === undefined || value === '' ? null : `${label}: ${value}`;
}

function compactDetails(values: Array<string | null>) {
  return values.filter((value): value is string => Boolean(value));
}

function assistantPhaseLabel(phase: AssistantActivityEventDto['phase'], labels: TraceLabels) {
  return labels.assistantPhases[phase];
}

function assistantLane(phase: AssistantActivityEventDto['phase']): AiActivityTraceLane {
  if (phase === 'CREATION_SAVED') return 'INPUT';
  if (phase === 'MODEL_REQUESTED' || phase === 'MODEL_RESPONDING') return 'MODEL';
  return 'PROCESS';
}

function assistantEventDetails(event: AssistantActivityEventDto, labels: TraceLabels) {
  const usageResult = assistantUsagePayloadSchema.safeParse(event.payload);
  return compactDetails([
    field(labels.fields.provider, event.providerKey),
    field(labels.fields.model, event.modelKey),
    usageResult.success
      ? labels.usage(
          usageResult.data.usage.promptTokens,
          usageResult.data.usage.completionTokens,
          usageResult.data.usage.totalTokens,
        )
      : null,
  ]);
}

function projectAssistantTrace(
  record: AssistantActivityRecord,
  labels: AiCenterLabels,
  now: number,
): AiActivityTraceProjection {
  const events = (record.run.activityEvents ?? [])
    .filter((event) => event.assistantRunId === record.run.id)
    .sort(
      (left, right) =>
        left.sequence - right.sequence ||
        (parseTimestamp(left.createdAt) ?? Number.MAX_SAFE_INTEGER) -
          (parseTimestamp(right.createdAt) ?? Number.MAX_SAFE_INTEGER),
    );
  const entries: AiActivityTraceEntry[] = [
    {
      id: `${record.id}:input`,
      sequence: 1,
      lane: 'INPUT',
      label: labels.trace.inputCaptured,
      details: record.run.input.prompt ? [record.run.input.prompt] : [],
      startedAt: record.run.createdAt,
      endedAt: null,
      point: true,
      call: false,
    },
  ];
  const runningEnd = record.run.status === 'RUNNING' ? new Date(now).toISOString() : null;

  for (const [index, event] of events.entries()) {
    const nextEvent = events[index + 1];
    const terminal = event.phase === 'COMPLETED' || event.phase === 'FAILED' || event.phase === 'INTERRUPTED';
    entries.push({
      id: `${record.id}:event:${event.id}`,
      sequence: entries.length + 1,
      lane: assistantLane(event.phase),
      label: assistantPhaseLabel(event.phase, labels.trace),
      details: assistantEventDetails(event, labels.trace),
      startedAt: event.createdAt,
      endedAt: terminal ? null : (nextEvent?.createdAt ?? record.run.finishedAt ?? runningEnd),
      point: terminal,
      call: event.phase === 'MODEL_REQUESTED' || event.phase === 'MODEL_RESPONDING',
    });
  }

  if (events.length === 0) {
    entries.push({
      id: `${record.id}:model`,
      sequence: entries.length + 1,
      lane: 'MODEL',
      label: labels.trace.modelCall,
      details: compactDetails([
        field(labels.trace.fields.provider, record.run.providerKey),
        field(labels.trace.fields.model, record.run.modelKey),
      ]),
      startedAt: record.run.createdAt,
      endedAt: record.run.finishedAt ?? runningEnd,
      point: record.run.finishedAt === null && runningEnd === null,
      call: true,
    });
    if (record.run.finishedAt) {
      entries.push({
        id: `${record.id}:terminal`,
        sequence: entries.length + 1,
        lane: 'PROCESS',
        label: statusLabel(record.run.status, labels),
        details: [],
        startedAt: record.run.finishedAt,
        endedAt: null,
        point: true,
        call: false,
      });
    }
  }

  return { entries, resolution: events.length > 0 ? 'EVENTS' : 'SUMMARY' };
}

const inputGenerationEventTypes = new Set(['CREATED', 'RETRY_CREATED', 'QUEUED']);
const modelGenerationEventTypes = new Set(['REQUEST_IDENTIFIED', 'REQUEST_ACCEPTED', 'REMOTE_OPERATION_ACCEPTED']);
const modelGenerationPhases = new Set(['SUBMITTING', 'UPLOADING', 'WAITING_PROVIDER', 'GENERATING', 'DOWNLOADING']);
const terminalGenerationEventTypes = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED']);
const durationGenerationEventTypes = new Set(['CREATED', 'RETRY_CREATED', 'QUEUED', 'RUNNING', 'PHASE_CHANGED']);

function generationEventLane(event: GenerationProcessEventHeaderDto): AiActivityTraceLane {
  if (inputGenerationEventTypes.has(event.eventType)) return 'INPUT';
  if (modelGenerationEventTypes.has(event.eventType) || (event.phase && modelGenerationPhases.has(event.phase))) {
    return 'MODEL';
  }
  return 'PROCESS';
}

function generationEventTypeLabel(eventType: string, labels: TraceLabels) {
  return (labels.generationEvents as Record<string, string>)[eventType] ?? eventType;
}

function generationPhaseLabel(phase: string, labels: TraceLabels) {
  return (labels.generationPhases as Record<string, string>)[phase] ?? phase;
}

function generationEventDetails(event: GenerationProcessEventHeaderDto, labels: TraceLabels) {
  const payloadDetails: Array<string | null> = [];
  if (event.payload.kind === 'PROVIDER_REQUEST') {
    payloadDetails.push(field(labels.fields.provider, event.payload.providerKey));
  } else if (event.payload.kind === 'FAILURE') {
    payloadDetails.push(
      field(labels.fields.errorCode, event.payload.errorCode),
      field(labels.fields.providerCode, event.payload.providerCode),
    );
  } else if (event.payload.kind === 'OUTPUT') {
    payloadDetails.push(field(labels.fields.output, event.payload.assetId));
  }
  return compactDetails([
    event.phase ? field(labels.fields.phase, generationPhaseLabel(event.phase, labels)) : null,
    event.progress === null ? null : field(labels.fields.progress, `${Math.round(event.progress * 100)}%`),
    event.statusMessage,
    ...payloadDetails,
  ]);
}

function projectDetailedGenerationTrace(
  record: GenerationActivityRecord,
  events: GenerationProcessEventHeaderDto[],
  summary: GenerationProcessSummaryDto | null,
  labels: AiCenterLabels,
): AiActivityTraceProjection {
  const orderedEvents = [...events].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      (parseTimestamp(left.createdAt) ?? Number.MAX_SAFE_INTEGER) -
        (parseTimestamp(right.createdAt) ?? Number.MAX_SAFE_INTEGER),
  );
  const prompt =
    record.run.executionSummary?.resolvedPrompt ||
    record.run.executionInputSnapshot?.commonInput.resolvedPrompt.commonExpression ||
    record.version.finalPrompt;
  const entries: AiActivityTraceEntry[] = [
    {
      id: `${record.id}:input`,
      sequence: 1,
      lane: 'INPUT',
      label: labels.trace.inputCaptured,
      details: prompt ? [prompt] : [],
      startedAt: record.run.createdAt,
      endedAt: null,
      point: true,
      call: false,
    },
  ];
  for (const [index, event] of orderedEvents.entries()) {
    const nextEvent = orderedEvents[index + 1];
    const point =
      terminalGenerationEventTypes.has(event.eventType) || !durationGenerationEventTypes.has(event.eventType);
    const lane = generationEventLane(event);
    entries.push({
      id: `${record.id}:process:${event.id}`,
      sequence: entries.length + 1,
      lane,
      label: generationEventTypeLabel(event.eventType, labels.trace),
      details: generationEventDetails(event, labels.trace),
      startedAt: event.createdAt,
      endedAt: point ? null : (nextEvent?.createdAt ?? summary?.finishedAt ?? record.run.finishedAt ?? null),
      point,
      call: lane === 'MODEL',
    });
  }
  return { entries, resolution: 'EVENTS' };
}

function projectGenerationSummaryTrace(
  record: GenerationActivityRecord,
  data: BootstrapDto,
  labels: AiCenterLabels,
  now: number,
): AiActivityTraceProjection {
  const prompt =
    record.run.executionSummary?.resolvedPrompt ||
    record.run.executionInputSnapshot?.commonInput.resolvedPrompt.commonExpression ||
    record.version.finalPrompt;
  const provider = providerName(record.run, data);
  const startedAt = record.run.startedAt ?? record.run.createdAt;
  const running = record.run.status === 'QUEUED' || record.run.status === 'RUNNING';
  const runningEnd = running ? new Date(now).toISOString() : null;
  const entries: AiActivityTraceEntry[] = [
    {
      id: `${record.id}:input`,
      sequence: 1,
      lane: 'INPUT',
      label: labels.trace.inputCaptured,
      details: prompt ? [prompt] : [],
      startedAt: record.run.createdAt,
      endedAt: null,
      point: true,
      call: false,
    },
    {
      id: `${record.id}:model`,
      sequence: 2,
      lane: 'MODEL',
      label: labels.trace.modelCall,
      details: compactDetails([
        field(labels.trace.fields.provider, provider),
        field(labels.trace.fields.model, modelName(record.run, data)),
        field(labels.trace.fields.status, statusLabel(record.run.status, labels)),
      ]),
      startedAt,
      endedAt: record.run.finishedAt ?? runningEnd,
      point: !record.run.finishedAt && !running,
      call: true,
    },
  ];
  if (record.run.finishedAt) {
    entries.push({
      id: `${record.id}:terminal`,
      sequence: 3,
      lane: 'PROCESS',
      label: statusLabel(record.run.status, labels),
      details: compactDetails([field(labels.trace.fields.errorCode, record.run.errorCode)]),
      startedAt: record.run.finishedAt,
      endedAt: null,
      point: true,
      call: false,
    });
  }
  return { entries, resolution: 'SUMMARY' };
}

function allGenerationRuns(data: BootstrapDto) {
  return data.series.flatMap((series) => series.versions.flatMap((version) => version.runs));
}

function projectExperimentTrace(
  record: ExperimentActivityRecord,
  data: BootstrapDto,
  labels: AiCenterLabels,
  now: number,
): AiActivityTraceProjection {
  const runById = new Map(allGenerationRuns(data).map((run) => [run.id, run]));
  const slotByRunId = new Map(record.batch.slots.flatMap((slot) => slot.runIds.map((runId) => [runId, slot])));
  const entries: AiActivityTraceEntry[] = [
    {
      id: `${record.id}:input`,
      sequence: 1,
      lane: 'INPUT',
      label: labels.trace.experimentStarted,
      details: record.batch.commonConstraints.length
        ? [field(labels.trace.fields.constraints, record.batch.commonConstraints.join(', '))!]
        : [],
      startedAt: record.batch.createdAt,
      endedAt: null,
      point: true,
      call: false,
    },
  ];
  const director = record.batch.directorTask;
  if (director) {
    const running =
      !director.finishedAt && !['SUCCEEDED', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED'].includes(director.status);
    entries.push({
      id: `${record.id}:director:${director.id}`,
      sequence: entries.length + 1,
      lane: 'PROCESS',
      label: labels.trace.experimentDirector,
      details: [director.objective],
      startedAt: director.createdAt,
      endedAt: director.finishedAt ?? (running ? new Date(now).toISOString() : director.updatedAt),
      point: false,
      call: false,
    });
  }
  for (const runId of record.batch.slots.flatMap((slot) => slot.runIds)) {
    const run = runById.get(runId);
    if (!run) continue;
    const slot = slotByRunId.get(runId);
    const running = run.status === 'QUEUED' || run.status === 'RUNNING';
    entries.push({
      id: `${record.id}:run:${run.id}`,
      sequence: entries.length + 1,
      lane: 'MODEL',
      label: slot ? `${slot.label} · ${modelName(run, data)}` : modelName(run, data),
      details: compactDetails([
        field(labels.trace.fields.provider, providerName(run, data)),
        field(labels.trace.fields.status, statusLabel(run.status, labels)),
      ]),
      startedAt: run.startedAt ?? run.createdAt,
      endedAt: run.finishedAt ?? (running ? new Date(now).toISOString() : null),
      point: !run.finishedAt && !running,
      call: true,
    });
  }
  const running = record.batch.status === 'QUEUED' || record.batch.status === 'RUNNING';
  if (!running) {
    entries.push({
      id: `${record.id}:terminal`,
      sequence: entries.length + 1,
      lane: 'PROCESS',
      label: statusLabel(record.batch.status, labels),
      details: [],
      startedAt: record.batch.updatedAt,
      endedAt: null,
      point: true,
      call: false,
    });
  }
  return { entries, resolution: 'SUMMARY' };
}

function videoModel(record: VideoDocumentActivityRecord) {
  if (record.activity.type === 'TRANSCRIPT_RECOGNITION') return record.activity.run.modelId;
  return record.activity.run.actualModel ?? record.activity.run.requestedModel;
}

function videoCallLabel(record: VideoDocumentActivityRecord, labels: TraceLabels) {
  if (record.activity.type === 'ARTICLE_GENERATION') return labels.articleCall;
  if (record.activity.type === 'TRANSCRIPT_RECOGNITION') return labels.transcriptionCall;
  return labels.translationCall;
}

function projectVideoDocumentTrace(
  record: VideoDocumentActivityRecord,
  labels: AiCenterLabels,
  now: number,
): AiActivityTraceProjection {
  const run = record.activity.run;
  const running = run.status === 'RUNNING';
  const entries: AiActivityTraceEntry[] = [
    {
      id: `${record.id}:input`,
      sequence: 1,
      lane: 'INPUT',
      label: labels.trace.inputCaptured,
      details: [record.activity.documentTitle],
      startedAt: run.startedAt,
      endedAt: null,
      point: true,
      call: false,
    },
    {
      id: `${record.id}:model`,
      sequence: 2,
      lane: 'MODEL',
      label: videoCallLabel(record, labels.trace),
      details: compactDetails([
        field(labels.trace.fields.provider, run.providerKey),
        field(labels.trace.fields.model, videoModel(record)),
        field(labels.trace.fields.status, statusLabel(run.status, labels)),
      ]),
      startedAt: run.startedAt,
      endedAt: run.finishedAt ?? (running ? new Date(now).toISOString() : null),
      point: !run.finishedAt && !running,
      call: true,
    },
  ];
  if (run.finishedAt) {
    entries.push({
      id: `${record.id}:terminal`,
      sequence: 3,
      lane: 'PROCESS',
      label: statusLabel(run.status, labels),
      details: compactDetails([field(labels.trace.fields.errorCode, run.errorCode)]),
      startedAt: run.finishedAt,
      endedAt: null,
      point: true,
      call: false,
    });
  }
  return { entries, resolution: 'SUMMARY' };
}

export function projectAiActivityTrace(
  record: AiActivityRecord,
  data: BootstrapDto,
  processEvents: GenerationProcessEventHeaderDto[],
  processSummary: GenerationProcessSummaryDto | null,
  labels: AiCenterLabels,
  now: number,
): AiActivityTraceProjection {
  if (record.kind === 'ASSISTANT') return projectAssistantTrace(record, labels, now);
  if (record.kind === 'EXPERIMENT') return projectExperimentTrace(record, data, labels, now);
  if (record.kind === 'VIDEO_DOCUMENT') return projectVideoDocumentTrace(record, labels, now);
  return processEvents.length > 0
    ? projectDetailedGenerationTrace(record, processEvents, processSummary, labels)
    : projectGenerationSummaryTrace(record, data, labels, now);
}
