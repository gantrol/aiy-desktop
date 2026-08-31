import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CircleCheckIcon, Clock3Icon, ListChecksIcon, LoaderCircleIcon } from 'lucide-react';
import type { ImageGenerationRouteDto, Locale } from '@/shared/contracts';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { cn } from '@/renderer/lib/utils';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  activityDomain,
  activityStatusFilter,
  type AiActivityCategory,
  type AiActivityRecord,
} from '@/renderer/features/ai-center/activityProjection';
import {
  projectAiStatistics,
  type AiStatisticsBreakdownItem,
  type AiStatisticsPeriod,
  type AiStatisticsScope,
  type AiStatisticsTrendPoint,
} from '@/renderer/features/ai-center/aiStatistics';

interface Props {
  active: boolean;
  records: AiActivityRecord[];
  routes: ImageGenerationRouteDto[];
  locale: Locale;
}

interface DurationFormatters {
  seconds(value: number): string;
  minutesSeconds(minutes: number, seconds: number): string;
  hoursMinutes(hours: number, minutes: number): string;
}

function formatDuration(milliseconds: number | null, formatters: DurationFormatters) {
  if (milliseconds === null) return '—';
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return formatters.hoursMinutes(hours, minutes);
  if (minutes > 0) return formatters.minutesSeconds(minutes, seconds);
  return formatters.seconds(seconds);
}

function Metric({
  icon,
  label,
  value,
  tone = 'neutral',
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'info';
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-4 py-4 sm:px-5">
      <span
        aria-hidden="true"
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-lg bg-surface-sunken text-foreground-secondary [&_svg]:size-5',
          tone === 'success' && 'bg-success-surface text-success',
          tone === 'warning' && 'bg-warning-surface text-warning',
          tone === 'info' && 'bg-info-surface text-info',
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="truncate text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 truncate text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
      </div>
    </div>
  );
}

function TrendChart({ points, label, empty }: { points: AiStatisticsTrendPoint[]; label: string; empty: string }) {
  const width = 720;
  const height = 220;
  const plot = { left: 44, right: 12, top: 14, bottom: 34 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const maximum = Math.max(1, ...points.map((point) => point.count));
  const coordinates = points.map((point, index) => ({
    x:
      points.length === 1
        ? plot.left + plotWidth / 2
        : plot.left + (index / Math.max(1, points.length - 1)) * plotWidth,
    y: plot.top + plotHeight - (point.count / maximum) * plotHeight,
  }));
  const linePath = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const areaPath = coordinates.length
    ? `${linePath} L ${coordinates.at(-1)!.x} ${plot.top + plotHeight} L ${coordinates[0].x} ${plot.top + plotHeight} Z`
    : '';
  const labelStride = Math.max(1, Math.ceil(points.length / 7));
  const hasData = points.some((point) => point.count > 0);
  const ticks = [maximum, Math.round(maximum / 2), 0];

  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} className="h-[220px] w-full overflow-visible">
      <title>{label}</title>
      {ticks.map((tick, index) => {
        const y = plot.top + (index / 2) * plotHeight;
        return (
          <g key={`${tick}:${index}`}>
            <text x={plot.left - 10} y={y + 3} textAnchor="end" fill="var(--muted-foreground)" fontSize="10">
              {tick}
            </text>
            <line
              x1={plot.left}
              x2={width - plot.right}
              y1={y}
              y2={y}
              stroke="var(--border)"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
      {hasData && <path d={areaPath} fill="var(--selected)" opacity="0.72" />}
      {hasData && (
        <path
          d={linePath}
          fill="none"
          stroke="var(--selected-foreground)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {hasData &&
        coordinates.map((point, index) => (
          <circle
            key={points[index].key}
            cx={point.x}
            cy={point.y}
            r="3.5"
            fill="var(--surface)"
            stroke="var(--selected-foreground)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      {!hasData && (
        <text
          x={plot.left + plotWidth / 2}
          y={plot.top + plotHeight / 2}
          textAnchor="middle"
          fill="var(--muted-foreground)"
          fontSize="12"
        >
          {empty}
        </text>
      )}
      {points.map((point, index) => {
        const visible = index % labelStride === 0 || index === points.length - 1;
        if (!visible) return null;
        const x = coordinates[index]?.x ?? plot.left;
        return (
          <text
            key={point.key}
            x={x}
            y={height - 8}
            textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
            fill="var(--muted-foreground)"
            fontSize="10"
          >
            {point.label}
          </text>
        );
      })}
    </svg>
  );
}

function CategoryBreakdown({
  items,
  labels,
  numberFormatter,
  percentFormatter,
}: {
  items: AiStatisticsBreakdownItem<AiActivityCategory>[];
  labels: Record<AiActivityCategory, string>;
  numberFormatter: Intl.NumberFormat;
  percentFormatter: Intl.NumberFormat;
}) {
  const maximum = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className="grid gap-3.5">
      {items.map((item) => (
        <div key={item.id} className="grid grid-cols-[5.5rem_minmax(5rem,1fr)_auto] items-center gap-3">
          <span className="truncate text-xs text-foreground-secondary">{labels[item.id]}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
            <span
              className="block h-full rounded-full bg-selected-foreground transition-[width] duration-base"
              style={{ width: `${(item.count / maximum) * 100}%` }}
            />
          </span>
          <span className="min-w-20 text-right text-xs tabular-nums text-foreground-secondary">
            {numberFormatter.format(item.count)}{' '}
            <span className="text-muted-foreground">({percentFormatter.format(item.share)})</span>
          </span>
        </div>
      ))}
    </div>
  );
}

const statusColors = {
  COMPLETED: 'var(--success)',
  ATTENTION: 'var(--warning)',
  RUNNING: 'var(--info)',
  EXPIRED: 'var(--muted-foreground)',
} as const;

function StatusBreakdown({
  items,
  total,
  labels,
  recordsLabel,
  numberFormatter,
  percentFormatter,
}: {
  items: AiStatisticsBreakdownItem<'COMPLETED' | 'ATTENTION' | 'RUNNING' | 'EXPIRED'>[];
  total: number;
  labels: Record<'COMPLETED' | 'ATTENTION' | 'RUNNING' | 'EXPIRED', string>;
  recordsLabel: string;
  numberFormatter: Intl.NumberFormat;
  percentFormatter: Intl.NumberFormat;
}) {
  const circumference = 2 * Math.PI * 46;
  let offset = 0;
  return (
    <div className="grid items-center gap-5 sm:grid-cols-[152px_minmax(0,1fr)]">
      <div className="relative mx-auto size-[152px]">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
          <circle cx="60" cy="60" r="46" fill="none" stroke="var(--surface-sunken)" strokeWidth="12" />
          {items.map((item) => {
            const length = circumference * item.share;
            const dashOffset = -offset;
            offset += length;
            return (
              <circle
                key={item.id}
                cx="60"
                cy="60"
                r="46"
                fill="none"
                stroke={statusColors[item.id]}
                strokeWidth="12"
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={dashOffset}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <strong className="text-lg font-semibold tabular-nums">{numberFormatter.format(total)}</strong>
          <span className="text-2xs text-muted-foreground">{recordsLabel}</span>
        </div>
      </div>
      <div className="grid gap-2.5">
        {items.map((item) => (
          <div key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-xs">
            <span className="size-2 rounded-full" style={{ backgroundColor: statusColors[item.id] }} />
            <span className="truncate text-foreground-secondary">{labels[item.id]}</span>
            <span className="tabular-nums">
              {numberFormatter.format(item.count)}{' '}
              <span className="text-muted-foreground">({percentFormatter.format(item.share)})</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AiStatisticsView({ active, records, routes, locale }: Props) {
  const l = useI18n().messages.aiCenter;
  const [scope, setScope] = useState<AiStatisticsScope>('IMAGE');
  const [period, setPeriod] = useState<AiStatisticsPeriod>('7D');
  const [now, setNow] = useState(() => Date.now());
  const hasRunning =
    active && records.some((record) => activityDomain(record) === scope && activityStatusFilter(record) === 'RUNNING');
  useEffect(() => {
    if (!hasRunning) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [hasRunning]);

  const snapshot = useMemo(
    () => projectAiStatistics(records, routes, period, scope, locale, now),
    [locale, routes, now, period, records, scope],
  );
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US'), [locale]);
  const percentFormatter = useMemo(
    () => new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { style: 'percent', maximumFractionDigits: 1 }),
    [locale],
  );
  const categoryLabels = {
    GENERATE: l.kinds.generate,
    EDIT: l.kinds.edit,
    DIRECTIONS: l.kinds.directions,
    OPTIMIZE: l.kinds.optimize,
    EXPERIMENT: l.kinds.experiment,
    VIDEO_ARTICLE: l.kinds.videoArticle,
    ARTICLE_CHECK: l.kinds.articleCheck,
    TRANSCRIBE: l.kinds.transcribe,
    TRANSLATE: l.kinds.translate,
  };
  const statusLabels = {
    COMPLETED: l.filters.completed,
    ATTENTION: l.filters.attention,
    RUNNING: l.filters.running,
    EXPIRED: l.filters.expired,
  };

  return (
    <ScrollArea className="min-h-0 flex-1 bg-background">
      <div data-ai-statistics className="mx-auto grid w-full max-w-7xl gap-4 p-5 lg:p-6">
        <header className="grid min-h-9 items-center gap-3 md:grid-cols-[1fr_auto_1fr]">
          <h2 className="text-lg font-semibold">{l.tabs.statistics}</h2>
          <Segmented
            type="single"
            value={scope}
            aria-label={l.stats.taskDomain}
            className="max-md:w-full"
            onValueChange={(value) => {
              if (value) setScope(value as AiStatisticsScope);
            }}
          >
            <SegmentedItem value="IMAGE" className="max-md:flex-1">
              {l.stats.image}
            </SegmentedItem>
            <SegmentedItem value="TEXT" className="max-md:flex-1">
              {l.stats.text}
            </SegmentedItem>
            <SegmentedItem value="DOCUMENT" className="max-md:flex-1">
              {l.stats.document}
            </SegmentedItem>
          </Segmented>
          <Segmented
            type="single"
            value={period}
            aria-label={l.stats.period}
            className="max-md:w-full md:justify-self-end"
            onValueChange={(value) => {
              if (value) setPeriod(value as AiStatisticsPeriod);
            }}
          >
            <SegmentedItem value="7D" className="max-md:flex-1">
              {l.stats.period7Days}
            </SegmentedItem>
            <SegmentedItem value="30D" className="max-md:flex-1">
              {l.stats.period30Days}
            </SegmentedItem>
            <SegmentedItem value="ALL" className="max-md:flex-1">
              {l.stats.periodAll}
            </SegmentedItem>
          </Segmented>
        </header>

        <dl className="grid overflow-hidden rounded-lg border bg-surface sm:grid-cols-2 xl:grid-cols-4 [&>*:not(:last-child)]:border-b sm:[&>*:nth-child(odd)]:border-r sm:[&>*:nth-child(3)]:border-b-0 xl:[&>*]:border-b-0 xl:[&>*:not(:last-child)]:border-r">
          <Metric
            icon={<ListChecksIcon />}
            label={
              scope === 'IMAGE' ? l.stats.imageTasks : scope === 'TEXT' ? l.stats.textTasks : l.stats.documentTasks
            }
            value={numberFormatter.format(snapshot.total)}
          />
          <Metric
            icon={<CircleCheckIcon />}
            label={l.stats.completionRate}
            value={snapshot.completionRate === null ? '—' : percentFormatter.format(snapshot.completionRate)}
            tone="success"
          />
          <Metric
            icon={<Clock3Icon />}
            label={l.stats.averageDuration}
            value={formatDuration(snapshot.averageDuration, l.stats)}
            tone="warning"
          />
          <Metric
            icon={<LoaderCircleIcon className={snapshot.running > 0 ? 'animate-spin' : undefined} />}
            label={l.stats.running}
            value={numberFormatter.format(snapshot.running)}
            tone="info"
          />
        </dl>

        <section className="grid overflow-hidden rounded-lg border bg-surface lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.9fr)]">
          <div className="min-w-0 border-b p-4 sm:p-5 lg:border-r lg:border-b-0">
            <h3 className="text-sm font-semibold">{l.stats.activityTrend}</h3>
            <div className="mt-3 min-w-0">
              <TrendChart points={snapshot.trend} label={l.stats.activityTrend} empty={l.stats.noData} />
            </div>
          </div>
          <div className="p-4 sm:p-5">
            <h3 className="text-sm font-semibold">{l.stats.taskTypes}</h3>
            <div className="mt-5">
              <CategoryBreakdown
                items={snapshot.categories}
                labels={categoryLabels}
                numberFormatter={numberFormatter}
                percentFormatter={percentFormatter}
              />
            </div>
          </div>
        </section>

        <section className="grid overflow-hidden rounded-lg border bg-surface lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.8fr)]">
          <div className="border-b p-4 sm:p-5 lg:border-r lg:border-b-0">
            <h3 className="text-sm font-semibold">{l.stats.taskStatus}</h3>
            <div className="mt-4">
              <StatusBreakdown
                items={snapshot.statuses}
                total={snapshot.total}
                labels={statusLabels}
                recordsLabel={l.stats.records}
                numberFormatter={numberFormatter}
                percentFormatter={percentFormatter}
              />
            </div>
          </div>
          <div className="min-w-0 p-4 sm:p-5">
            <h3 className="text-sm font-semibold">{l.stats.modelUsage}</h3>
            <div className="mt-3 overflow-hidden rounded-md border">
              <Table>
                <TableHeader className="bg-surface-sunken">
                  <TableRow className="hover:bg-surface-sunken">
                    <TableHead>{l.stats.model}</TableHead>
                    <TableHead>{l.stats.provider}</TableHead>
                    <TableHead numeric>{l.stats.usageCount}</TableHead>
                    <TableHead numeric>{l.stats.share}</TableHead>
                    <TableHead numeric>{l.stats.averageDuration}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshot.modelUsage.map((item) => (
                    <TableRow key={item.key}>
                      <TableCell className="max-w-52 truncate font-medium">{item.name}</TableCell>
                      <TableCell className="max-w-44 truncate text-foreground-secondary">
                        {item.provider ?? '—'}
                      </TableCell>
                      <TableCell numeric>{numberFormatter.format(item.count)}</TableCell>
                      <TableCell numeric>{percentFormatter.format(item.share)}</TableCell>
                      <TableCell numeric>{formatDuration(item.averageDuration, l.stats)}</TableCell>
                    </TableRow>
                  ))}
                  {snapshot.modelUsage.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={5} className="h-20 text-center text-muted-foreground">
                        {l.stats.noData}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}
