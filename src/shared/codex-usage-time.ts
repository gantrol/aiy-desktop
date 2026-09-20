import type {
  CodexUsageDateRange,
  CodexUsageQuotaYieldSample,
  CodexUsageQuotaYieldTimeSlice,
  CodexUsageRange,
  CodexUsageResolvedGranularity,
} from '@/shared/contracts/codex-usage';

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_TIME_SLICES = 5_000;

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  offset: string;
}

interface BucketIdentity {
  key: string;
  label: string;
  ordinal: number;
}

interface MutableSlice {
  identity: BucketIdentity;
  dimensionKey: string;
  sample: CodexUsageQuotaYieldSample;
  observedFrom: string;
  observedTo: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  quotaPercentObserved: number;
  requestCount: number;
  credits: number;
  creditsComplete: boolean;
  samples: CodexUsageQuotaYieldSample[];
}

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  const cached = partFormatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset',
  });
  partFormatters.set(timeZone, formatter);
  return formatter;
}

function zonedParts(value: string | number, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(value));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    offset: values.get('timeZoneName') ?? 'GMT',
  };
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function localDate(parts: ZonedParts) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function localDayOrdinal(parts: Pick<ZonedParts, 'year' | 'month' | 'day'>) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY_MS);
}

function isoWeek(parts: ZonedParts) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday + 3);
  const weekYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  const mondayOrdinal = localDayOrdinal(parts) - weekday;
  return { key: `${weekYear}-W${pad(week)}`, ordinal: Math.floor(mondayOrdinal / 7) };
}

function bucketIdentity(timestamp: string, granularity: CodexUsageResolvedGranularity, timeZone: string) {
  const parts = zonedParts(timestamp, timeZone);
  const date = localDate(parts);
  if (granularity === 'HOUR') {
    const hour = pad(parts.hour);
    return {
      key: `${date}T${hour}@${parts.offset}`,
      label: `${date} ${hour}:00 ${parts.offset}`,
      ordinal: Math.floor(Date.parse(timestamp) / HOUR_MS),
    } satisfies BucketIdentity;
  }
  if (granularity === 'SIX_HOURS') {
    const startHour = Math.floor(parts.hour / 6) * 6;
    return {
      key: `${date}T${pad(startHour)}`,
      label: `${date} ${pad(startHour)}:00–${pad(startHour + 6)}:00`,
      ordinal: localDayOrdinal(parts) * 4 + startHour / 6,
    } satisfies BucketIdentity;
  }
  if (granularity === 'DAY') {
    return { key: date, label: date, ordinal: localDayOrdinal(parts) } satisfies BucketIdentity;
  }
  const week = isoWeek(parts);
  return { key: week.key, label: week.key, ordinal: week.ordinal } satisfies BucketIdentity;
}

function dimensionKey(sample: CodexUsageQuotaYieldSample) {
  return [
    sample.attribution,
    sample.planType,
    sample.quotaKind,
    sample.limitId ?? '',
    sample.windowKind,
    sample.windowDurationMins ?? '',
    sample.model,
    sample.serviceTier,
  ].join('\u0000');
}

function addSafe(left: number, right: number) {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

function weightedQuantile(
  samples: readonly CodexUsageQuotaYieldSample[],
  percentile: number,
  value: (sample: CodexUsageQuotaYieldSample) => number = (sample) => sample.tokensPerOnePercent,
) {
  const sorted = [...samples].sort((left, right) => value(left) - value(right));
  const totalWeight = sorted.reduce((sum, sample) => sum + sample.quotaPercentConsumed, 0);
  const target = totalWeight * percentile;
  let cumulative = 0;
  for (const sample of sorted) {
    cumulative += sample.quotaPercentConsumed;
    if (cumulative >= target) return value(sample);
  }
  const last = sorted.at(-1);
  return last ? value(last) : 0;
}

function zonedDateTimeEpoch(value: { year: number; month: number; day: number; hour: number }, timeZone: string) {
  const desired = Date.UTC(value.year, value.month - 1, value.day, value.hour);
  let candidate = desired;
  for (let index = 0; index < 4; index += 1) {
    const actual = zonedParts(candidate, timeZone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour);
    const correction = desired - represented;
    candidate += correction;
    if (correction === 0) break;
  }
  return candidate;
}

function calendarDateParts(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

function nextCalendarDate(value: { year: number; month: number; day: number }) {
  const next = new Date(Date.UTC(value.year, value.month - 1, value.day + 1));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

export function codexUsageDefaultGranularity(range: CodexUsageRange): CodexUsageResolvedGranularity {
  if (range === 'TODAY' || range === 'LAST_24_HOURS') return 'HOUR';
  if (range === 'LAST_7_DAYS') return 'SIX_HOURS';
  if (range === 'ALL') return 'WEEK';
  return 'DAY';
}

export function codexUsageLocalDateKey(value: string | number, timeZone: string) {
  return localDate(zonedParts(value, timeZone));
}

export function codexUsageRangeStartEpoch(range: CodexUsageRange, toEpoch: number, timeZone: string) {
  if (range === 'ALL') return null;
  if (range === 'CUSTOM') throw new Error('Custom Codex usage ranges require explicit calendar dates');
  if (range === 'LAST_24_HOURS') return Math.max(0, toEpoch - DAY_MS);
  if (range === 'TODAY') {
    const current = zonedParts(toEpoch, timeZone);
    return zonedDateTimeEpoch({ year: current.year, month: current.month, day: current.day, hour: 0 }, timeZone);
  }
  const days = range === 'LAST_7_DAYS' ? 7 : range === 'LAST_30_DAYS' ? 30 : 90;
  const current = zonedParts(toEpoch, timeZone);
  const target = new Date(Date.UTC(current.year, current.month - 1, current.day));
  target.setUTCDate(target.getUTCDate() - (days - 1));
  return zonedDateTimeEpoch(
    {
      year: target.getUTCFullYear(),
      month: target.getUTCMonth() + 1,
      day: target.getUTCDate(),
      hour: 0,
    },
    timeZone,
  );
}

export function codexUsageDateRangeEpochs(
  range: CodexUsageDateRange,
  timeZone: string,
  maximumToEpoch: number = Date.now(),
) {
  const today = localDate(zonedParts(maximumToEpoch, timeZone));
  if (range.to > today) throw new Error('The selected Codex usage dates are in the future');
  const fromDate = calendarDateParts(range.from);
  const throughDate = calendarDateParts(range.to);
  const fromEpoch = zonedDateTimeEpoch({ ...fromDate, hour: 0 }, timeZone);
  if (fromEpoch < 0) throw new Error('The selected Codex usage dates are before the supported range');
  const throughEpoch = zonedDateTimeEpoch({ ...nextCalendarDate(throughDate), hour: 0 }, timeZone) - 1;
  const toEpoch = Math.min(maximumToEpoch, throughEpoch);
  if (toEpoch < fromEpoch) throw new Error('The selected Codex usage dates are in the future');
  return { fromEpoch, toEpoch };
}

export function buildCodexUsageTimeSlices(
  samples: readonly CodexUsageQuotaYieldSample[],
  granularity: CodexUsageResolvedGranularity,
  timeZone: string,
  maximumSlices = MAX_TIME_SLICES,
): CodexUsageQuotaYieldTimeSlice[] {
  const groups = new Map<string, MutableSlice>();
  for (const sample of samples) {
    const identity = bucketIdentity(sample.to, granularity, timeZone);
    const dimensions = dimensionKey(sample);
    const key = `${dimensions}\u0000${identity.key}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        identity,
        dimensionKey: dimensions,
        sample,
        observedFrom: sample.from,
        observedTo: sample.to,
        inputTokens: sample.inputTokens,
        cachedInputTokens: sample.cachedInputTokens,
        outputTokens: sample.outputTokens,
        reasoningOutputTokens: sample.reasoningOutputTokens,
        totalTokens: sample.totalTokens,
        quotaPercentObserved: sample.quotaPercentConsumed,
        requestCount: sample.requestCount,
        credits: sample.codexCredits ?? 0,
        creditsComplete: sample.codexCredits !== null,
        samples: [sample],
      });
      continue;
    }
    existing.totalTokens = addSafe(existing.totalTokens, sample.totalTokens);
    existing.inputTokens = addSafe(existing.inputTokens, sample.inputTokens);
    existing.cachedInputTokens = addSafe(existing.cachedInputTokens, sample.cachedInputTokens);
    existing.outputTokens = addSafe(existing.outputTokens, sample.outputTokens);
    existing.reasoningOutputTokens = addSafe(existing.reasoningOutputTokens, sample.reasoningOutputTokens);
    existing.quotaPercentObserved += sample.quotaPercentConsumed;
    existing.requestCount = addSafe(existing.requestCount, sample.requestCount);
    existing.credits += sample.codexCredits ?? 0;
    existing.creditsComplete &&= sample.codexCredits !== null;
    existing.samples.push(sample);
    if (sample.from < existing.observedFrom) existing.observedFrom = sample.from;
    if (sample.to > existing.observedTo) existing.observedTo = sample.to;
  }

  const mutable = [...groups.values()].sort(
    (left, right) =>
      left.dimensionKey.localeCompare(right.dimensionKey) ||
      left.identity.ordinal - right.identity.ordinal ||
      left.observedFrom.localeCompare(right.observedFrom),
  );
  const previousByDimension = new Map<string, { ordinal: number; medianTokensPerOnePercent: number }>();
  const slices = mutable.map((aggregate): CodexUsageQuotaYieldTimeSlice => {
    const tokensPerOnePercent = aggregate.totalTokens / aggregate.quotaPercentObserved;
    const medianTokensPerOnePercent = weightedQuantile(aggregate.samples, 0.5);
    const previous = previousByDimension.get(aggregate.dimensionKey);
    const changeFromPreviousPercent =
      previous && aggregate.identity.ordinal === previous.ordinal + 1 && previous.medianTokensPerOnePercent > 0
        ? (medianTokensPerOnePercent / previous.medianTokensPerOnePercent - 1) * 100
        : null;
    previousByDimension.set(aggregate.dimensionKey, {
      ordinal: aggregate.identity.ordinal,
      medianTokensPerOnePercent,
    });
    const sample = aggregate.sample;
    return {
      granularity,
      timeZone,
      attribution: sample.attribution,
      bucketKey: `${aggregate.dimensionKey}\u0000${aggregate.identity.key}`,
      label: aggregate.identity.label,
      observedFrom: aggregate.observedFrom,
      observedTo: aggregate.observedTo,
      planType: sample.planType,
      limitId: sample.limitId,
      quotaKind: sample.quotaKind,
      windowKind: sample.windowKind,
      windowDurationMins: sample.windowDurationMins,
      model: sample.model,
      serviceTier: sample.serviceTier,
      tokensPerOnePercent,
      medianTokensPerOnePercent,
      medianNonCachedTokensPerOnePercent: weightedQuantile(
        aggregate.samples,
        0.5,
        (sample) =>
          (Math.max(0, sample.inputTokens - sample.cachedInputTokens) + sample.outputTokens) /
          sample.quotaPercentConsumed,
      ),
      percentile25TokensPerOnePercent: weightedQuantile(aggregate.samples, 0.25),
      percentile75TokensPerOnePercent: weightedQuantile(aggregate.samples, 0.75),
      quotaPercentPerMillionTokens:
        aggregate.totalTokens > 0 ? (aggregate.quotaPercentObserved * 1_000_000) / aggregate.totalTokens : 0,
      codexCreditsPerOnePercent: aggregate.creditsComplete ? aggregate.credits / aggregate.quotaPercentObserved : null,
      totalTokens: aggregate.totalTokens,
      inputTokens: aggregate.inputTokens,
      cachedInputTokens: aggregate.cachedInputTokens,
      outputTokens: aggregate.outputTokens,
      reasoningOutputTokens: aggregate.reasoningOutputTokens,
      cachedInputPercent: aggregate.inputTokens > 0 ? (aggregate.cachedInputTokens / aggregate.inputTokens) * 100 : 0,
      quotaPercentObserved: aggregate.quotaPercentObserved,
      sampleCount: aggregate.samples.length,
      requestCount: aggregate.requestCount,
      changeFromPreviousPercent,
    };
  });
  return slices
    .sort(
      (left, right) =>
        left.observedFrom.localeCompare(right.observedFrom) || left.bucketKey.localeCompare(right.bucketKey),
    )
    .slice(-maximumSlices);
}
