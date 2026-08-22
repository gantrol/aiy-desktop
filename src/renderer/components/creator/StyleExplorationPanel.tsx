import {
  ArrowRightIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleStopIcon,
  Clock3Icon,
  FlaskConicalIcon,
  GitBranchPlusIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SquareStopIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  PromptSeriesDto,
  StyleExplorationBatchDto,
  StyleExplorationSlotDto,
  StyleExplorationStatus,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { ImageAmbientBackdrop } from '@/renderer/components/media/AmbientImage';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { StateTag } from '@/renderer/components/ui/state-tag';
import { DirectionExperimentDirectorSummary } from '@/renderer/components/creator/DirectionExperimentDirectorSummary';

interface StyleExplorationPanelProps {
  batches: StyleExplorationBatchDto[];
  series: PromptSeriesDto[];
  stoppingBatchIds?: string[];
  retryingSlotIds?: string[];
  proposingAdjacentSlotIds?: string[];
  className?: string;
  onStop(batchId: string): void | Promise<void>;
  onRetrySlot(batchId: string, slotId: string): void | Promise<void>;
  onProposeAdjacent?(slot: StyleExplorationSlotDto): void | Promise<void>;
  onContinueDirection(slot: StyleExplorationSlotDto): void;
  onOpenAsset?(assetId: string): void;
  notify?(message: string): void;
}

const copyByLocale = {
  en: {
    title: 'Direction experiments',
    completed: (done: number, total: number) => `${done} of ${total} complete`,
    active: (count: number) => `${count} active`,
    failed: (count: number) => `${count} failed`,
    cancelled: (count: number) => `${count} cancelled`,
    interrupted: (count: number) => `${count} interrupted`,
    stop: 'Stop remaining',
    stopping: 'Stopping',
    retry: 'Retry failed slot',
    retrying: 'Retrying',
    adjacent: 'Try adjacent variable',
    proposingAdjacent: 'Preparing adjacent directions',
    continue: 'Continue this direction',
    variable: 'Only variable',
    risk: 'Risk',
    results: 'Results',
    batchProgress: (index: number) => `Direction experiment ${index} progress`,
    directionProgress: (label: string) => `${label} progress`,
    openResult: (label: string, index: number) => `Open ${label} result ${index}`,
    directionDetails: (label: string) => `${label} direction details`,
    directions: (count: number) => `${count} ${count === 1 ? 'direction' : 'directions'}`,
    expand: 'Expand experiment',
    collapse: 'Collapse experiment',
    status: {
      QUEUED: 'Queued',
      RUNNING: 'Running',
      PARTIAL: 'Partially complete',
      SUCCEEDED: 'Complete',
      FAILED: 'Failed',
      CANCELLED: 'Cancelled',
      INTERRUPTED: 'Interrupted',
    },
  },
  zh: {
    title: '方向实验',
    completed: (done: number, total: number) => `已完成 ${done} / ${total}`,
    active: (count: number) => `${count} 项进行中`,
    failed: (count: number) => `${count} 项失败`,
    cancelled: (count: number) => `${count} 项已取消`,
    interrupted: (count: number) => `${count} 项已中断`,
    stop: '停止剩余任务',
    stopping: '正在停止',
    retry: '重试失败槽位',
    retrying: '正在重试',
    adjacent: '试相邻变量',
    proposingAdjacent: '正在准备相邻方向',
    continue: '继续此方向',
    variable: '唯一变化轴',
    risk: '风险',
    results: '结果',
    batchProgress: (index: number) => `方向实验 ${index} 进度`,
    directionProgress: (label: string) => `${label}进度`,
    openResult: (label: string, index: number) => `打开${label}的第 ${index} 个结果`,
    directionDetails: (label: string) => `${label}方向详情`,
    directions: (count: number) => `${count} 个方向`,
    expand: '展开方向实验',
    collapse: '收起方向实验',
    status: {
      QUEUED: '排队中',
      RUNNING: '运行中',
      PARTIAL: '部分完成',
      SUCCEEDED: '已完成',
      FAILED: '失败',
      CANCELLED: '已取消',
      INTERRUPTED: '已中断',
    },
  },
} as const;

const retryStatuses = new Set<StyleExplorationStatus>(['FAILED', 'CANCELLED', 'INTERRUPTED']);

function statusTone(status: StyleExplorationStatus): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  if (status === 'SUCCEEDED') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'PARTIAL' || status === 'INTERRUPTED') return 'warning';
  if (status === 'RUNNING') return 'info';
  return 'neutral';
}

function statusIcon(status: StyleExplorationStatus) {
  if (status === 'RUNNING') return <LoaderCircleIcon className="animate-spin" />;
  if (status === 'SUCCEEDED') return <CircleCheckIcon />;
  if (status === 'FAILED' || status === 'INTERRUPTED') return <CircleAlertIcon />;
  if (status === 'CANCELLED') return <CircleStopIcon />;
  return <Clock3Icon />;
}

function slotAssets(slot: StyleExplorationSlotDto, series: PromptSeriesDto[]) {
  const owner = series.find((item) => item.id === slot.seriesId);
  const version = owner?.versions.find((item) => item.id === slot.versionId);
  const allowedRunIds = new Set(slot.runIds);
  return (version?.runs ?? []).flatMap((run) =>
    run.asset && run.outputDisposition !== 'FAILED' && allowedRunIds.has(run.id) ? [run.asset] : [],
  );
}

interface StyleExplorationSlotCardProps {
  batchId: string;
  batchTerminal: boolean;
  slot: StyleExplorationSlotDto;
  series: PromptSeriesDto[];
  retrying: boolean;
  proposingAdjacent: boolean;
  onRetrySlot(batchId: string, slotId: string): void | Promise<void>;
  onProposeAdjacent(slot: StyleExplorationSlotDto): void | Promise<void>;
  onContinueDirection(slot: StyleExplorationSlotDto): void;
  onOpenAsset?(assetId: string): void;
  notify?(message: string): void;
}

function StyleExplorationSlotCard({
  batchId,
  batchTerminal,
  slot,
  series,
  retrying,
  proposingAdjacent,
  onRetrySlot,
  onProposeAdjacent,
  onContinueDirection,
  onOpenAsset,
  notify,
}: StyleExplorationSlotCardProps) {
  const { locale } = useI18n();
  const copy = copyByLocale[locale];
  const assets = slotAssets(slot, series);
  const backgroundAssets = assets.slice(0, 5);
  const retryable =
    retryStatuses.has(slot.status) ||
    (slot.status === 'PARTIAL' && slot.completedCount < slot.totalCount && batchTerminal);
  const slotPercent =
    slot.totalCount > 0 ? Math.min(100, Math.round((slot.completedCount / slot.totalCount) * 100)) : 0;
  const slotProgressText = [
    copy.completed(slot.completedCount, slot.totalCount),
    slot.activeCount > 0 ? copy.active(slot.activeCount) : '',
    slot.failedCount > 0 ? copy.failed(slot.failedCount) : '',
    slot.cancelledCount > 0 ? copy.cancelled(slot.cancelledCount) : '',
    slot.interruptedCount > 0 ? copy.interrupted(slot.interruptedCount) : '',
  ]
    .filter(Boolean)
    .join(locale === 'zh' ? '，' : ', ');
  const visualState = assets.length > 0 ? 'results' : slot.status.toLowerCase();
  const mediaGrid =
    backgroundAssets.length <= 1
      ? 'grid-cols-1'
      : backgroundAssets.length === 2
        ? 'grid-cols-2'
        : backgroundAssets.length === 5
          ? 'grid-cols-3 grid-rows-2'
          : 'grid-cols-2 grid-rows-2';

  return (
    <article
      data-style-exploration-slot={slot.id}
      data-slot-visual={visualState}
      aria-busy={slot.activeCount > 0 || slot.status === 'QUEUED' || slot.status === 'RUNNING'}
      className="group/slot relative isolate min-h-72 overflow-hidden rounded-lg border bg-background"
    >
      {backgroundAssets.length > 0 ? (
        <div data-slot-media className={cn('peer/media absolute inset-0 grid gap-px bg-border', mediaGrid)}>
          {backgroundAssets.map((asset, index) => {
            const cellClassName = cn(
              'relative isolate min-h-0 min-w-0 overflow-hidden bg-surface-sunken outline-none',
              backgroundAssets.length === 3 && index === 0 && 'row-span-2',
              backgroundAssets.length === 5 && index === 0 && 'col-span-2',
              onOpenAsset &&
                'cursor-pointer focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            );
            const image = (
              <>
                <ImageAmbientBackdrop src={asset.mediaUrl} loading="lazy" />
                <img
                  src={asset.mediaUrl}
                  alt=""
                  className="relative z-10 size-full object-contain transition-transform duration-base ease-enter motion-reduce:transition-none"
                  loading="lazy"
                  draggable={false}
                />
              </>
            );
            const content = onOpenAsset ? (
              <button
                type="button"
                aria-label={copy.openResult(slot.label, index + 1)}
                className={cellClassName}
                onClick={() => onOpenAsset(asset.id)}
              >
                {image}
              </button>
            ) : (
              <div className={cellClassName}>{image}</div>
            );
            return notify ? (
              <AssetFileContextMenu
                key={asset.id}
                assetId={asset.id}
                notify={notify}
                revealContext={{ kind: 'CREATION', seriesId: slot.seriesId }}
              >
                {content}
              </AssetFileContextMenu>
            ) : (
              <div key={asset.id} className="contents">
                {content}
              </div>
            );
          })}
          {assets.length > backgroundAssets.length && (
            <span
              aria-hidden="true"
              className="absolute bottom-3 right-3 z-10 rounded-md border bg-overlay/90 px-2 py-1 text-xs font-semibold shadow-overlay backdrop-blur-sm"
            >
              +{assets.length - backgroundAssets.length}
            </span>
          )}
        </div>
      ) : (
        <div
          data-slot-media-state
          aria-hidden="true"
          className={cn(
            'absolute inset-0 grid place-items-center overflow-hidden',
            (slot.status === 'RUNNING' || slot.status === 'QUEUED') && 'bg-info-surface/45 text-info',
            slot.status === 'FAILED' && 'bg-destructive-surface text-destructive',
            slot.status === 'INTERRUPTED' && 'bg-warning-surface text-warning',
            slot.status === 'CANCELLED' && 'bg-surface-sunken text-muted-foreground',
            !['RUNNING', 'QUEUED', 'FAILED', 'INTERRUPTED', 'CANCELLED'].includes(slot.status) &&
              'bg-surface-sunken text-foreground-secondary',
          )}
        >
          {(slot.status === 'RUNNING' || slot.status === 'QUEUED') && (
            <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-transparent via-background/45 to-transparent motion-reduce:animate-none" />
          )}
          <div className="relative flex flex-col items-center gap-2 text-xs font-semibold [&_svg]:size-8">
            {statusIcon(slot.status)}
            <span>{copy.status[slot.status]}</span>
          </div>
        </div>
      )}

      <details
        data-slot-title-region
        className="group/title absolute inset-x-0 top-0 z-20 overflow-hidden bg-transparent outline-none transition-[background-color,opacity] duration-fast peer-hover/media:opacity-30 peer-focus-within/media:opacity-30 hover:bg-overlay/95 hover:opacity-100 focus-within:bg-overlay/95 focus-within:opacity-100 focus-visible:bg-overlay/95 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <summary
          aria-label={copy.directionDetails(slot.label)}
          className="flex cursor-pointer list-none items-start justify-between gap-3 p-3 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
        >
          <div className="min-w-0 rounded-md border bg-overlay/90 px-2.5 py-1.5 shadow-overlay backdrop-blur-sm">
            <h3 className="truncate text-sm font-semibold">{slot.label}</h3>
          </div>
          <StateTag tone={statusTone(slot.status)} icon={statusIcon(slot.status)}>
            {copy.status[slot.status]}
          </StateTag>
        </summary>

        <div
          data-slot-details
          className="invisible block max-h-0 overflow-hidden px-3 opacity-0 transition-[max-height,opacity,padding] duration-base group-hover/title:visible group-hover/title:max-h-80 group-hover/title:pb-3 group-hover/title:opacity-100 group-focus-within/title:visible group-focus-within/title:max-h-80 group-focus-within/title:pb-3 group-focus-within/title:opacity-100 group-open/title:visible group-open/title:max-h-80 group-open/title:pb-3 group-open/title:opacity-100 motion-reduce:transition-none"
        >
          <p className="text-xs leading-relaxed text-foreground-secondary">{slot.rationale}</p>
          {(slot.variableAxis || slot.risk) && (
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              {slot.variableAxis && (
                <div>
                  <span className="text-2xs text-muted-foreground">{copy.variable}</span>
                  <p className="mt-0.5 font-medium">{slot.variableAxis}</p>
                </div>
              )}
              {slot.risk && (
                <div>
                  <span className="text-2xs text-warning">{copy.risk}</span>
                  <p className="mt-0.5 text-foreground-secondary">{slot.risk}</p>
                </div>
              )}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
            <span className="tabular-nums">{copy.completed(slot.completedCount, slot.totalCount)}</span>
            {slot.activeCount > 0 && <span className="text-info tabular-nums">{copy.active(slot.activeCount)}</span>}
            {slot.failedCount > 0 && (
              <span className="text-destructive tabular-nums">{copy.failed(slot.failedCount)}</span>
            )}
            {slot.cancelledCount > 0 && <span className="tabular-nums">{copy.cancelled(slot.cancelledCount)}</span>}
            {slot.interruptedCount > 0 && (
              <span className="text-warning tabular-nums">{copy.interrupted(slot.interruptedCount)}</span>
            )}
          </div>
          {(retryable || slot.completedCount > 0) && (
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {retryable && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={retrying}
                  onClick={() => void onRetrySlot(batchId, slot.id)}
                >
                  {retrying ? (
                    <LoaderCircleIcon className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="size-3.5" />
                  )}
                  {retrying ? copy.retrying : copy.retry}
                </Button>
              )}
              {slot.completedCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  disabled={proposingAdjacent}
                  onClick={() => void onProposeAdjacent(slot)}
                >
                  {proposingAdjacent ? (
                    <LoaderCircleIcon className="size-3.5 animate-spin" />
                  ) : (
                    <GitBranchPlusIcon className="size-3.5" />
                  )}
                  {proposingAdjacent ? copy.proposingAdjacent : copy.adjacent}
                </Button>
              )}
              {slot.completedCount > 0 && (
                <Button type="button" variant="secondary" size="xs" onClick={() => onContinueDirection(slot)}>
                  {copy.continue}
                  <ArrowRightIcon className="size-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>
      </details>

      <div
        className="absolute inset-x-0 bottom-0 z-20 h-1.5 overflow-hidden bg-overlay/55"
        role="progressbar"
        aria-label={copy.directionProgress(slot.label)}
        aria-valuemin={0}
        aria-valuemax={Math.max(1, slot.totalCount)}
        aria-valuenow={slot.completedCount}
        aria-valuetext={slotProgressText}
      >
        <div className="h-full bg-primary transition-[width] duration-base" style={{ width: `${slotPercent}%` }} />
      </div>
    </article>
  );
}

export function StyleExplorationPanel({
  batches,
  series,
  stoppingBatchIds = [],
  retryingSlotIds = [],
  proposingAdjacentSlotIds = [],
  className,
  onStop,
  onRetrySlot,
  onProposeAdjacent = () => undefined,
  onContinueDirection,
  onOpenAsset,
  notify,
}: StyleExplorationPanelProps) {
  const { locale } = useI18n();
  const copy = copyByLocale[locale];
  const [expandedBatchIds, setExpandedBatchIds] = useState(() =>
    batches.filter((batch) => batch.status !== 'SUCCEEDED').map((batch) => batch.id),
  );

  useEffect(() => {
    const available = new Set(batches.map((batch) => batch.id));
    setExpandedBatchIds((current) => {
      const next = current.filter((id) => available.has(id));
      for (const batch of batches) {
        if (batch.status !== 'SUCCEEDED' && !next.includes(batch.id)) next.push(batch.id);
      }
      return next;
    });
  }, [batches]);

  if (batches.length === 0) return null;

  const orderedBatches = [...batches].sort(
    (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
  );

  return (
    <section data-style-exploration-panel className={cn('space-y-2', className)} aria-label={copy.title}>
      {orderedBatches.map((batch, batchIndex) => {
        const expanded = expandedBatchIds.includes(batch.id);
        const stopping = stoppingBatchIds.includes(batch.id);
        const hasActiveSlot = batch.slots.some((slot) => slot.activeCount > 0);
        const canStop = batch.activeCount > 0 || hasActiveSlot;
        const completionPercent =
          batch.totalCount > 0 ? Math.min(100, Math.round((batch.completedCount / batch.totalCount) * 100)) : 0;
        const batchProgressText = [
          copy.completed(batch.completedCount, batch.totalCount),
          batch.activeCount > 0 ? copy.active(batch.activeCount) : '',
          batch.failedCount > 0 ? copy.failed(batch.failedCount) : '',
          batch.cancelledCount > 0 ? copy.cancelled(batch.cancelledCount) : '',
          batch.interruptedCount > 0 ? copy.interrupted(batch.interruptedCount) : '',
        ]
          .filter(Boolean)
          .join(locale === 'zh' ? '，' : ', ');
        return (
          <Collapsible
            key={batch.id}
            open={expanded}
            onOpenChange={(open) =>
              setExpandedBatchIds((current) =>
                open ? [...new Set([...current, batch.id])] : current.filter((id) => id !== batch.id),
              )
            }
            asChild
          >
            <article data-style-exploration-batch={batch.id} className="overflow-hidden rounded-xl border bg-surface">
              <header
                className={cn(
                  'flex flex-wrap items-center gap-3 bg-surface-sunken/35 px-4 py-3',
                  expanded && 'border-b',
                )}
              >
                <StateTag tone={statusTone(batch.status)} icon={statusIcon(batch.status)}>
                  {copy.status[batch.status]}
                </StateTag>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                  <FlaskConicalIcon className="size-3.5 text-primary" />
                  {copy.title}
                </span>
                <span className="text-2xs text-muted-foreground">{copy.directions(batch.slots.length)}</span>
                <span className="text-xs font-medium tabular-nums">
                  {copy.completed(batch.completedCount, batch.totalCount)}
                </span>
                {batch.activeCount > 0 && (
                  <span className="text-2xs font-medium text-info tabular-nums">{copy.active(batch.activeCount)}</span>
                )}
                {batch.failedCount > 0 && (
                  <span className="text-2xs font-medium text-destructive tabular-nums">
                    {copy.failed(batch.failedCount)}
                  </span>
                )}
                {batch.cancelledCount > 0 && (
                  <span className="text-2xs font-medium text-muted-foreground tabular-nums">
                    {copy.cancelled(batch.cancelledCount)}
                  </span>
                )}
                {batch.interruptedCount > 0 && (
                  <span className="text-2xs font-medium text-warning tabular-nums">
                    {copy.interrupted(batch.interruptedCount)}
                  </span>
                )}
                <div
                  className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-surface-sunken"
                  role="progressbar"
                  aria-label={copy.batchProgress(batchIndex + 1)}
                  aria-valuemin={0}
                  aria-valuemax={Math.max(1, batch.totalCount)}
                  aria-valuenow={batch.completedCount}
                  aria-valuetext={batchProgressText}
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-base"
                    style={{ width: `${completionPercent}%` }}
                  />
                </div>
                {canStop && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={stopping}
                    onClick={() => void onStop(batch.id)}
                  >
                    {stopping ? (
                      <LoaderCircleIcon className="size-3.5 animate-spin" />
                    ) : (
                      <SquareStopIcon className="size-3.5" />
                    )}
                    {stopping ? copy.stopping : copy.stop}
                  </Button>
                )}
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    title={expanded ? copy.collapse : copy.expand}
                    aria-label={expanded ? copy.collapse : copy.expand}
                  >
                    <ChevronDownIcon className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
                  </Button>
                </CollapsibleTrigger>
              </header>

              <CollapsibleContent>
                {batch.directorTask && <DirectionExperimentDirectorSummary locale={locale} task={batch.directorTask} />}
                {batch.commonConstraints.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 border-b px-4 py-2">
                    {batch.commonConstraints.map((constraint, index) => (
                      <span
                        key={`${constraint}:${index}`}
                        className="rounded-full bg-surface-sunken px-2 py-1 text-2xs text-foreground-secondary"
                      >
                        {constraint}
                      </span>
                    ))}
                  </div>
                )}

                <div className="grid gap-3 p-3 lg:grid-cols-2">
                  {[...batch.slots]
                    .sort((left, right) => left.sortOrder - right.sortOrder)
                    .map((slot) => (
                      <StyleExplorationSlotCard
                        key={slot.id}
                        batchId={batch.id}
                        batchTerminal={batch.activeCount === 0 && !hasActiveSlot}
                        slot={slot}
                        series={series}
                        retrying={retryingSlotIds.includes(slot.id)}
                        proposingAdjacent={proposingAdjacentSlotIds.includes(slot.id)}
                        onRetrySlot={onRetrySlot}
                        onProposeAdjacent={onProposeAdjacent}
                        onContinueDirection={onContinueDirection}
                        onOpenAsset={onOpenAsset}
                        notify={notify}
                      />
                    ))}
                </div>
              </CollapsibleContent>
            </article>
          </Collapsible>
        );
      })}
    </section>
  );
}

export type { StyleExplorationPanelProps };
