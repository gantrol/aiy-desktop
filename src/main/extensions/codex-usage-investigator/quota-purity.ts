import { setImmediate } from 'node:timers/promises';
import {
  CODEX_USAGE_DEFAULT_QUOTA_SAMPLE_PERCENT,
  codexUsageQuotaSamplePercentSchema,
} from '@/shared/contracts/codex-usage';
import type {
  CodexUsageQuotaPurity,
  CodexUsageQuotaPuritySample,
  CodexUsageQuotaWindowKind,
} from '@/shared/contracts/codex-usage';
import type { CodexUsageCacheDatabase } from '@/main/extensions/codex-usage-investigator/cache-database';
import type { CodexUsageInternalEvent } from '@/main/extensions/codex-usage-investigator/session-reader';
import { normalizeCodexUsageModel } from '@/main/extensions/codex-usage-investigator/pricing';

export const CODEX_QUOTA_PURITY_VERSION = 2;
const MAX_SAMPLES = 20_000;
const MINUTE_MS = 60_000;
const EPSILON = 1e-9;

interface Observation {
  event: CodexUsageInternalEvent;
  windowKind: CodexUsageQuotaWindowKind;
  used: number;
  duration: number;
  resetsAt: number;
}

interface Stream {
  observation: Observation;
  minute: number;
  pending: CodexUsageInternalEvent[];
  baseline: number | null;
  previous: number | null;
  from: string;
  gap: number;
  usage: CodexUsageInternalEvent['usage'];
  models: Set<string>;
  tiers: Set<CodexUsageInternalEvent['serviceTier']>;
  requests: number;
  inferred: boolean;
}

const emptyUsage = (): Stream['usage'] => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
});

function observations(event: CodexUsageInternalEvent): Observation[] {
  if (!event.planType || event.quotaKind === 'UNKNOWN') return [];
  const windows = [
    ['PRIMARY', event.usedPercent, event.windowDurationMins, event.resetsAt],
    ['SECONDARY', event.secondaryUsedPercent, event.secondaryWindowDurationMins, event.secondaryResetsAt],
  ] as const;
  const at = Date.parse(event.timestamp) / 1_000;
  return windows.flatMap(([windowKind, used, duration, resetsAt]) =>
    used !== null &&
    duration !== null &&
    duration > 0 &&
    resetsAt !== null &&
    at <= resetsAt &&
    at >= resetsAt - duration * 60
      ? [{ event, windowKind, used, duration, resetsAt }]
      : [],
  );
}

/** Historical usage between quota observations, never the current account balance. */
export class CodexQuotaPurityAccumulator {
  private readonly streams = new Map<string, Stream>();
  private gap = 0;
  private readonly resultValue: CodexUsageQuotaPurity = {
    algorithmVersion: CODEX_QUOTA_PURITY_VERSION,
    minimumQuotaPercent: CODEX_USAGE_DEFAULT_QUOTA_SAMPLE_PERCENT,
    scope: 'LOCAL_RECORDS_ACCOUNT_QUOTA',
    samples: [],
    eligibleSampleCount: 0,
    mixedSampleCount: 0,
    nonConsecutiveSampleCount: 0,
    unknownSampleCount: 0,
    boundaryCount: 0,
    missingQuotaEventCount: 0,
    staleSnapshotCount: 0,
    inferredSampleCount: 0,
    samplesTruncated: false,
  };

  constructor(minimumQuotaPercent: number = CODEX_USAGE_DEFAULT_QUOTA_SAMPLE_PERCENT) {
    this.resultValue.minimumQuotaPercent = codexUsageQuotaSamplePercentSchema.parse(minimumQuotaPercent);
  }

  add(event: CodexUsageInternalEvent) {
    const values = observations(event);
    if (!values.length && event.usage.totalTokens > 0) {
      this.resultValue.missingQuotaEventCount += 1;
      this.gap += 1;
    }
    for (const observation of values) {
      const key = JSON.stringify([
        event.planType,
        event.quotaKind,
        event.limitId,
        observation.windowKind,
        observation.duration,
      ]);
      const minute = Math.floor(Date.parse(event.timestamp) / MINUTE_MS);
      let stream = this.streams.get(key);
      if (stream && observation.resetsAt < stream.observation.resetsAt - 300) {
        this.resultValue.staleSnapshotCount += 1;
        continue;
      }
      if (stream && (minute !== stream.minute || observation.resetsAt > stream.observation.resetsAt + 300)) {
        this.commit(stream);
      }
      if (!stream || observation.resetsAt > stream.observation.resetsAt + 300) {
        if (stream) this.resultValue.boundaryCount += 1;
        stream = {
          observation,
          minute,
          pending: [],
          baseline: null,
          previous: null,
          from: event.timestamp,
          gap: this.gap,
          usage: emptyUsage(),
          models: new Set(),
          tiers: new Set(),
          requests: 0,
          inferred: false,
        };
        this.streams.set(key, stream);
      }
      if (minute !== stream.minute) {
        stream.minute = minute;
        stream.observation = observation;
      } else if (observation.used >= stream.observation.used) {
        stream.observation = observation;
      }
      if (event.usage.totalTokens > 0) stream.pending.push(event);
    }
  }

  private reset(stream: Stream) {
    stream.baseline = stream.observation.used;
    stream.from = stream.observation.event.timestamp;
    stream.usage = emptyUsage();
    stream.models.clear();
    stream.tiers.clear();
    stream.requests = 0;
    stream.inferred = false;
    stream.gap = this.gap;
  }

  private commit(stream: Stream) {
    const { observation } = stream;
    if (
      stream.baseline === null ||
      stream.gap !== this.gap ||
      (stream.previous !== null && observation.used < stream.previous - EPSILON)
    ) {
      if (stream.baseline !== null) this.resultValue.boundaryCount += 1;
      this.reset(stream);
    } else {
      for (const event of stream.pending) {
        for (const key of Object.keys(stream.usage) as Array<keyof Stream['usage']>) {
          stream.usage[key] = Math.min(Number.MAX_SAFE_INTEGER, stream.usage[key] + event.usage[key]);
        }
        stream.models.add(normalizeCodexUsageModel(event.model) || 'unknown');
        stream.tiers.add(event.serviceTier);
        stream.inferred ||= event.serviceTierInferred;
        stream.requests += 1;
      }
      const consumed = observation.used - stream.baseline;
      // Accumulate the selected span to reduce integer-reading boundary noise.
      // Larger jumps use their observed delta; incomplete tails are never zero-cost samples.
      if (consumed >= this.resultValue.minimumQuotaPercent - EPSILON) {
        if (stream.models.size > 1 || stream.tiers.size > 1) this.resultValue.mixedSampleCount += 1;
        else if (!stream.usage.totalTokens || stream.models.has('unknown') || stream.tiers.has('UNKNOWN'))
          this.resultValue.unknownSampleCount += 1;
        else {
          const sample: CodexUsageQuotaPuritySample = {
            attribution: 'MODEL_TIER',
            planType: observation.event.planType!,
            limitId: observation.event.limitId,
            quotaKind: observation.event.quotaKind,
            windowKind: observation.windowKind,
            windowDurationMins: observation.duration,
            model: [...stream.models][0]!,
            serviceTier: [...stream.tiers][0] as 'STANDARD' | 'FAST',
            from: stream.from,
            to: observation.event.timestamp,
            resetsAt: observation.resetsAt,
            quotaPercentConsumed: consumed,
            requestCount: stream.requests,
            ...stream.usage,
            tokensPerOnePercent: stream.usage.totalTokens / consumed,
            quotaPercentPerMillionTokens: (consumed * 1_000_000) / stream.usage.totalTokens,
          };
          this.resultValue.samples.push(sample);
          this.resultValue.eligibleSampleCount += 1;
          if (stream.inferred) this.resultValue.inferredSampleCount += 1;
          if (this.resultValue.samples.length > MAX_SAMPLES * 2) {
            this.resultValue.samples.splice(0, MAX_SAMPLES);
            this.resultValue.samplesTruncated = true;
          }
        }
        this.reset(stream);
      }
    }
    stream.previous = observation.used;
    stream.pending = [];
  }

  result(): CodexUsageQuotaPurity {
    for (const stream of this.streams.values()) this.commit(stream);
    const samples = this.resultValue.samples.sort((a, b) => a.to.localeCompare(b.to));
    return {
      ...this.resultValue,
      samples: samples.slice(-MAX_SAMPLES),
      samplesTruncated: this.resultValue.samplesTruncated || samples.length > MAX_SAMPLES,
    };
  }
}

export async function readCodexQuotaPurity(
  cache: CodexUsageCacheDatabase,
  from: string | null,
  to: string,
  minimumQuotaPercent: number = CODEX_USAGE_DEFAULT_QUOTA_SAMPLE_PERCENT,
) {
  const accumulator = new CodexQuotaPurityAccumulator(minimumQuotaPercent);
  for (const page of cache.eventPages(from === null ? null : Date.parse(from), Date.parse(to))) {
    for (const event of page) accumulator.add(event);
    await setImmediate();
  }
  return accumulator.result();
}
