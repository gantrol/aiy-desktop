import {
  AudioLinesIcon,
  FileTextIcon,
  FlaskConicalIcon,
  ImagePlusIcon,
  LightbulbIcon,
  ListChecksIcon,
  LanguagesIcon,
  PaintbrushIcon,
} from 'lucide-react';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import { AiActivityStatusTag } from '@/renderer/features/ai-center/AiActivityStatusTag';
import { activityDuration, type AiActivityRecord } from '@/renderer/features/ai-center/activityProjection';

interface DurationFormatters {
  seconds(value: number): string;
  minutesSeconds(minutes: number, seconds: number): string;
  hoursMinutes(hours: number, minutes: number): string;
}

export function formatAiActivityDuration(milliseconds: number, formatters: DurationFormatters) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return formatters.hoursMinutes(hours, minutes);
  if (minutes > 0) return formatters.minutesSeconds(minutes, seconds);
  return formatters.seconds(seconds);
}

function ActivityKindIcon({ record }: { record: AiActivityRecord }) {
  if (record.kind === 'ASSISTANT') {
    return record.run.mode === 'directions' ? (
      <LightbulbIcon className="size-4" />
    ) : (
      <ListChecksIcon className="size-4" />
    );
  }
  if (record.kind === 'EXPERIMENT') return <FlaskConicalIcon className="size-4" />;
  if (record.kind === 'VIDEO_DOCUMENT') {
    if (record.activity.type === 'ARTICLE_GENERATION') return <FileTextIcon className="size-4" />;
    return record.activity.type === 'TRANSCRIPT_RECOGNITION' ? (
      <AudioLinesIcon className="size-4" />
    ) : (
      <LanguagesIcon className="size-4" />
    );
  }
  return record.operation === 'EDIT' ? <PaintbrushIcon className="size-4" /> : <ImagePlusIcon className="size-4" />;
}

function sourceName(
  record: AiActivityRecord,
  currentDraftId: string | null,
  draft: string,
  unknown: string,
  preferCreationTitle: boolean,
) {
  if (record.kind === 'VIDEO_DOCUMENT') return record.activity.documentTitle;
  if (preferCreationTitle && record.kind === 'ASSISTANT' && record.run.creationTitle) return record.run.creationTitle;
  if (preferCreationTitle && record.kind === 'EXPERIMENT' && record.sourceRun?.creationTitle)
    return record.sourceRun.creationTitle;
  if (record.sourceSeries) return record.sourceSeries.title;
  if (record.kind !== 'GENERATION') {
    const scope = record.kind === 'ASSISTANT' ? record.run.scope : record.batch.scope;
    if (scope.kind === 'DRAFT' && scope.id === currentDraftId) return draft;
  }
  return unknown;
}

interface Props {
  record: AiActivityRecord;
  selected: boolean;
  currentDraftId: string | null;
  modelNameByKey: ReadonlyMap<string, string>;
  dateFormatter: Intl.DateTimeFormat;
  now: number;
  variant?: 'TIMELINE' | 'OUTLINE';
  onSelect(recordId: string): void;
}

export function AiActivityRow({
  record,
  selected,
  currentDraftId,
  modelNameByKey,
  dateFormatter,
  now,
  variant = 'TIMELINE',
  onSelect,
}: Props) {
  const l = useI18n().messages.aiCenter;
  const source = sourceName(record, currentDraftId, l.source.draft, l.source.unknown, variant === 'OUTLINE');
  const kind =
    record.kind === 'ASSISTANT'
      ? record.run.mode === 'directions'
        ? l.kinds.directions
        : l.kinds.optimize
      : record.kind === 'EXPERIMENT'
        ? l.kinds.experiment
        : record.kind === 'VIDEO_DOCUMENT'
          ? record.activity.type === 'ARTICLE_GENERATION'
            ? l.kinds.videoArticle
            : record.activity.type === 'TRANSCRIPT_RECOGNITION'
              ? l.kinds.transcribe
              : l.kinds.translate
          : record.operation === 'EDIT'
            ? l.kinds.edit
            : l.kinds.generate;
  const title =
    record.kind === 'ASSISTANT' && record.occurrenceCount > 1
      ? `${kind} · ${l.occurrence(record.ordinal)}`
      : variant === 'TIMELINE'
        ? `${kind} · ${source}`
        : kind;
  const secondary =
    record.kind === 'GENERATION'
      ? `${l.version(record.version.versionNo)} · ${modelNameByKey.get(record.run.modelKey) ?? record.run.modelKey}`
      : record.kind === 'EXPERIMENT'
        ? `${record.batch.slots.length} ${l.fields.directions} · ${record.batch.completedCount}/${record.batch.totalCount}`
        : record.kind === 'VIDEO_DOCUMENT'
          ? record.activity.type === 'ARTICLE_GENERATION'
            ? (record.activity.run.actualModel ?? record.activity.run.requestedModel)
            : record.activity.type === 'TRANSCRIPT_RECOGNITION'
              ? record.activity.run.totalChunks === null
                ? record.activity.run.modelId
                : `${record.activity.run.modelId} · ${record.activity.run.completedChunks}/${record.activity.run.totalChunks}`
              : `${record.activity.run.actualModel ?? record.activity.run.requestedModel} · ${record.activity.run.targetLocales.join(', ')}`
          : source;
  const duration = activityDuration(record, now);

  return (
    <button
      type="button"
      data-ai-activity-id={record.id}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'grid w-full grid-cols-[34px_minmax(0,1fr)_auto] gap-3 border-l-2 border-l-transparent px-3 py-3 text-left outline-none transition-colors duration-fast hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        variant === 'OUTLINE' && 'grid-cols-[30px_minmax(0,1fr)_auto] gap-2.5 px-2.5 py-2.5',
        selected && 'border-l-selected-foreground bg-selected',
      )}
      onClick={() => onSelect(record.id)}
    >
      <span
        className={cn(
          'grid size-[34px] place-items-center rounded-md bg-surface-sunken text-foreground-secondary',
          variant === 'OUTLINE' && 'size-[30px]',
        )}
      >
        <ActivityKindIcon record={record} />
      </span>
      <span className="min-w-0">
        <strong className="block truncate text-sm font-medium">{title}</strong>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{secondary}</span>
        <span className="mt-1 flex min-w-0 items-center gap-1 text-2xs text-muted-foreground">
          <time dateTime={record.createdAt}>{dateFormatter.format(new Date(record.createdAt))}</time>
          {duration && (
            <>
              <span>·</span>
              <span>
                {duration.running ? l.stats.elapsed : l.stats.duration}{' '}
                {formatAiActivityDuration(duration.milliseconds, l.stats)}
              </span>
            </>
          )}
        </span>
      </span>
      <AiActivityStatusTag record={record} />
    </button>
  );
}
