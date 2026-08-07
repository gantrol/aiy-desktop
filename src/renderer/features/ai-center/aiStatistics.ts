import type { ImageGenerationRouteDto, Locale } from '@/shared/contracts';
import {
  activityCategory,
  activityDomain,
  activityDuration,
  activityStatusFilter,
  type AiActivityCategory,
  type AiActivityDomain,
  type AiActivityRecord,
  type AiActivityStatusFilter,
} from '@/renderer/features/ai-center/activityProjection';

export type AiStatisticsPeriod = '7D' | '30D' | 'ALL';
export type AiStatisticsScope = AiActivityDomain;

export interface AiStatisticsBreakdownItem<Id extends string> {
  id: Id;
  count: number;
  share: number;
}

export interface AiStatisticsTrendPoint {
  key: string;
  label: string;
  count: number;
}

export interface AiStatisticsModelUsage {
  key: string;
  name: string;
  provider: string | null;
  count: number;
  share: number;
  averageDuration: number | null;
}

export interface AiStatisticsSnapshot {
  total: number;
  completed: number;
  completionRate: number | null;
  averageDuration: number | null;
  running: number;
  categories: Array<AiStatisticsBreakdownItem<AiActivityCategory>>;
  statuses: Array<AiStatisticsBreakdownItem<Exclude<AiActivityStatusFilter, 'ALL'>>>;
  trend: AiStatisticsTrendPoint[];
  modelUsage: AiStatisticsModelUsage[];
}

const categoryOrderByScope = {
  IMAGE: ['GENERATE', 'EDIT', 'EXPERIMENT'],
  TEXT: ['DIRECTIONS', 'OPTIMIZE'],
} as const satisfies Record<AiStatisticsScope, readonly AiActivityCategory[]>;
const statusOrder = ['COMPLETED', 'ATTENTION', 'RUNNING', 'EXPIRED'] as const;

function startOfLocalDay(value: number) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function yearKey(date: Date) {
  return String(date.getFullYear());
}

function dailyTrend(start: Date, end: Date, locale: Locale) {
  const formatter = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'numeric',
    day: 'numeric',
  });
  const points: AiStatisticsTrendPoint[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    points.push({ key: dateKey(cursor), label: formatter.format(cursor), count: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

function monthlyTrend(start: Date, end: Date, locale: Locale) {
  const formatter = new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: '2-digit',
    month: 'numeric',
  });
  const points: AiStatisticsTrendPoint[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const finalMonth = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= finalMonth) {
    points.push({ key: monthKey(cursor), label: formatter.format(cursor), count: 0 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return points;
}

function yearlyTrend(start: Date, end: Date) {
  const points: AiStatisticsTrendPoint[] = [];
  for (let year = start.getFullYear(); year <= end.getFullYear(); year += 1) {
    points.push({ key: String(year), label: String(year), count: 0 });
  }
  return points;
}

function trendFor(records: AiActivityRecord[], period: AiStatisticsPeriod, locale: Locale, now: number) {
  const today = startOfLocalDay(now);
  let keyForRecord = dateKey;
  let points: AiStatisticsTrendPoint[];

  if (period !== 'ALL') {
    const start = new Date(today);
    start.setDate(start.getDate() - (period === '7D' ? 6 : 29));
    points = dailyTrend(start, today, locale);
  } else {
    const validDates = records
      .map((record) => new Date(record.createdAt))
      .filter((date) => Number.isFinite(date.getTime()) && date.getTime() <= now)
      .sort((left, right) => left.getTime() - right.getTime());
    const earliest = validDates[0] ? startOfLocalDay(validDates[0].getTime()) : new Date(today);
    if (!validDates.length) earliest.setDate(earliest.getDate() - 6);
    const days = Math.floor((today.getTime() - earliest.getTime()) / 86_400_000) + 1;
    const months = (today.getFullYear() - earliest.getFullYear()) * 12 + today.getMonth() - earliest.getMonth() + 1;
    if (days <= 31) {
      points = dailyTrend(earliest, today, locale);
    } else if (months <= 24) {
      points = monthlyTrend(earliest, today, locale);
      keyForRecord = monthKey;
    } else {
      points = yearlyTrend(earliest, today);
      keyForRecord = yearKey;
    }
  }

  const pointByKey = new Map(points.map((point) => [point.key, point]));
  for (const record of records) {
    const date = new Date(record.createdAt);
    if (!Number.isFinite(date.getTime())) continue;
    const point = pointByKey.get(keyForRecord(date));
    if (point) point.count += 1;
  }
  return points;
}

function filteredRecords(
  records: AiActivityRecord[],
  period: AiStatisticsPeriod,
  scope: AiStatisticsScope,
  now: number,
) {
  const domainRecords = records.filter((record) => activityDomain(record) === scope);
  if (period === 'ALL') return domainRecords;
  const start = startOfLocalDay(now);
  start.setDate(start.getDate() - (period === '7D' ? 6 : 29));
  return domainRecords.filter((record) => {
    const createdAt = Date.parse(record.createdAt);
    return Number.isFinite(createdAt) && createdAt >= start.getTime() && createdAt <= now;
  });
}

interface ModelReference {
  key: string;
  provider: string | null;
}

function modelReferences(record: AiActivityRecord, routes: Map<string, ImageGenerationRouteDto>): ModelReference[] {
  if (record.kind === 'GENERATION') {
    const snapshot = record.run.modelSnapshot?.descriptor;
    const model = routes.get(record.run.modelKey);
    return [{ key: record.run.modelKey, provider: snapshot?.provider ?? model?.provider ?? null }];
  }
  if (record.kind === 'ASSISTANT') {
    const key = record.run.modelKey ?? record.run.providerKey ?? 'codex';
    return [{ key, provider: record.run.providerKey ?? null }];
  }
  const modelKeys = record.sourceRun?.input.generationTargets.map((target) => target.modelKey) ?? [];
  return [...new Set(modelKeys)].map((key) => ({ key, provider: routes.get(key)?.provider ?? null }));
}

function modelUsageFor(records: AiActivityRecord[], modelList: ImageGenerationRouteDto[], now: number) {
  const routes = new Map(modelList.map((model) => [model.key, model]));
  const aggregate = new Map<
    string,
    { name: string; provider: string | null; count: number; totalDuration: number; durationCount: number }
  >();

  for (const record of records) {
    const duration = activityDuration(record, now);
    for (const reference of modelReferences(record, routes)) {
      const model = routes.get(reference.key);
      const current = aggregate.get(reference.key) ?? {
        name: model?.name ?? reference.key,
        provider: model?.provider ?? reference.provider,
        count: 0,
        totalDuration: 0,
        durationCount: 0,
      };
      current.count += 1;
      if (duration && !duration.running) {
        current.totalDuration += duration.milliseconds;
        current.durationCount += 1;
      }
      aggregate.set(reference.key, current);
    }
  }

  const totalAssociations = [...aggregate.values()].reduce((sum, item) => sum + item.count, 0);
  return [...aggregate.entries()]
    .map(([key, item]): AiStatisticsModelUsage => ({
      key,
      name: item.name,
      provider: item.provider,
      count: item.count,
      share: totalAssociations > 0 ? item.count / totalAssociations : 0,
      averageDuration: item.durationCount > 0 ? item.totalDuration / item.durationCount : null,
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

export function projectAiStatistics(
  records: AiActivityRecord[],
  routes: ImageGenerationRouteDto[],
  period: AiStatisticsPeriod,
  scope: AiStatisticsScope,
  locale: Locale,
  now = Date.now(),
): AiStatisticsSnapshot {
  const scopedRecords = filteredRecords(records, period, scope, now);
  const categoryOrder = categoryOrderByScope[scope];
  const categoryCounts = new Map<AiActivityCategory, number>(categoryOrder.map((category) => [category, 0]));
  const statusCounts = new Map(statusOrder.map((status) => [status, 0]));

  for (const record of scopedRecords) {
    const category = activityCategory(record);
    const status = activityStatusFilter(record);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
  }

  const completed = statusCounts.get('COMPLETED') ?? 0;
  const running = statusCounts.get('RUNNING') ?? 0;
  const completedDurations = scopedRecords
    .filter((record) => activityStatusFilter(record) === 'COMPLETED')
    .flatMap((record) => {
      const duration = activityDuration(record, now);
      return duration && !duration.running ? [duration] : [];
    });
  const averageDuration = completedDurations.length
    ? completedDurations.reduce((sum, duration) => sum + duration.milliseconds, 0) / completedDurations.length
    : null;

  return {
    total: scopedRecords.length,
    completed,
    completionRate: scopedRecords.length > 0 ? completed / scopedRecords.length : null,
    averageDuration,
    running,
    categories: categoryOrder.map((id) => ({
      id,
      count: categoryCounts.get(id) ?? 0,
      share: scopedRecords.length > 0 ? (categoryCounts.get(id) ?? 0) / scopedRecords.length : 0,
    })),
    statuses: statusOrder.map((id) => ({
      id,
      count: statusCounts.get(id) ?? 0,
      share: scopedRecords.length > 0 ? (statusCounts.get(id) ?? 0) / scopedRecords.length : 0,
    })),
    trend: trendFor(scopedRecords, period, locale, now),
    modelUsage: modelUsageFor(scopedRecords, routes, now),
  };
}
