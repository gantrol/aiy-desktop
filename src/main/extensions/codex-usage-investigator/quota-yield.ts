import type {
  CodexUsageQuotaCycle,
  CodexUsageQuotaKind,
  CodexUsageQuotaWindowKind,
  CodexUsageQuotaYieldAnalysis,
  CodexUsageQuotaYieldEstimate,
  CodexUsageQuotaYieldSample,
  CodexUsageRange,
  CodexUsageServiceTier,
} from '@/shared/contracts/codex-usage';
import { codexUsageDefaultGranularity } from '@/shared/codex-usage-time';
import { codexUsageStandardEquivalentMultiplier } from '@/shared/codex-usage-speed';
import type { CodexUsageEventCoverage } from '@/main/extensions/codex-usage-investigator/cache-database';
import {
  estimateCodexUsage,
  normalizeCodexUsageModel,
  type CodexUsageBreakdown,
} from '@/main/extensions/codex-usage-investigator/pricing';
import type { CodexUsageInternalEvent } from '@/main/extensions/codex-usage-investigator/session-reader';

const WEEKLY_WINDOW_MINUTES = 7 * 24 * 60;
const RESET_SCHEDULE_BUCKET_SECONDS = 5 * 60;
const OBSERVATION_BUCKET_MS = 60 * 1_000;
const MAX_RETURNED_CYCLES = 2_000;
const EPSILON = 1e-9;

interface QuotaObservation {
  timestamp: string;
  usedPercent: number;
  resetsAt: number;
  windowDurationMins: number;
  planType: string;
  limitId: string | null;
  quotaKind: CodexUsageQuotaKind;
  windowKind: CodexUsageQuotaWindowKind;
}

interface MutableModelUsage {
  model: string;
  serviceTier: CodexUsageServiceTier;
  inferredServiceTierTokens: number;
  totalTokens: number;
  requestCount: number;
}

interface CycleQuotaSnapshot {
  usedPercent: number;
}

interface CycleState {
  key: string;
  observation: QuotaObservation;
  resetsAt: number;
  observedFrom: string;
  observedTo: string;
  quotaSnapshots: Map<number, CycleQuotaSnapshot>;
  pendingBucket: number | null;
  pendingEvents: CodexUsageInternalEvent[];
  previousUsedPercent: number | null;
  usage: CodexUsageBreakdown;
  requestCount: number;
  models: Map<string, MutableModelUsage>;
  standardEquivalentTokens: number;
  standardEquivalentNonCachedTokens: number;
  standardEquivalentApiUsd: number;
  standardEquivalentComplete: boolean;
  apiComplete: boolean;
  credits: number;
  creditsComplete: boolean;
}

interface MutableEstimate {
  sample: CodexUsageQuotaYieldSample;
  usage: CodexUsageBreakdown;
  requestCount: number;
  quotaPercentObserved: number;
  credits: number;
  creditsComplete: boolean;
  samples: CodexUsageQuotaYieldSample[];
  firstAt: string;
  lastAt: string;
}

interface AccumulatorOptions {
  coverage: CodexUsageEventCoverage;
  range: CodexUsageRange;
  timeZone: string;
}

function emptyUsage(): CodexUsageBreakdown {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };
}

function addSafe(left: number, right: number) {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

function addUsage(target: CodexUsageBreakdown, usage: CodexUsageBreakdown) {
  target.inputTokens = addSafe(target.inputTokens, usage.inputTokens);
  target.cachedInputTokens = addSafe(target.cachedInputTokens, usage.cachedInputTokens);
  target.cacheWriteInputTokens = addSafe(target.cacheWriteInputTokens, usage.cacheWriteInputTokens);
  target.outputTokens = addSafe(target.outputTokens, usage.outputTokens);
  target.reasoningOutputTokens = addSafe(target.reasoningOutputTokens, usage.reasoningOutputTokens);
  target.totalTokens = addSafe(target.totalTokens, usage.totalTokens);
}

function resetScheduleBucket(resetsAt: number) {
  return Math.round(resetsAt / RESET_SCHEDULE_BUCKET_SECONDS);
}

function cycleKey(observation: QuotaObservation) {
  return [
    observation.planType,
    observation.quotaKind,
    observation.limitId ?? '',
    observation.windowKind,
    observation.windowDurationMins,
    resetScheduleBucket(observation.resetsAt),
  ].join('\u0000');
}

function streamKey(observation: QuotaObservation) {
  return [
    observation.planType,
    observation.quotaKind,
    observation.limitId ?? '',
    observation.windowKind,
    observation.windowDurationMins,
  ].join('\u0000');
}

function weeklyObservation(
  event: CodexUsageInternalEvent,
  windowKind: CodexUsageQuotaWindowKind,
  usedPercent: number | null,
  windowDurationMins: number | null,
  resetsAt: number | null,
): QuotaObservation | null {
  if (
    event.quotaKind !== 'MAIN' ||
    !event.planType ||
    usedPercent === null ||
    windowDurationMins === null ||
    Math.abs(windowDurationMins - WEEKLY_WINDOW_MINUTES) > EPSILON ||
    resetsAt === null
  ) {
    return null;
  }
  const observedAt = Date.parse(event.timestamp) / 1_000;
  const startsAt = resetsAt - windowDurationMins * 60;
  if (!Number.isFinite(observedAt) || observedAt < startsAt || observedAt > resetsAt) return null;
  return {
    timestamp: event.timestamp,
    usedPercent,
    resetsAt,
    windowDurationMins,
    planType: event.planType,
    limitId: event.limitId,
    quotaKind: event.quotaKind,
    windowKind,
  };
}

function observationsFor(event: CodexUsageInternalEvent) {
  return [
    weeklyObservation(event, 'PRIMARY', event.usedPercent, event.windowDurationMins, event.resetsAt),
    weeklyObservation(
      event,
      'SECONDARY',
      event.secondaryUsedPercent,
      event.secondaryWindowDurationMins,
      event.secondaryResetsAt,
    ),
  ].filter((observation): observation is QuotaObservation => observation !== null);
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

function estimateKey(sample: CodexUsageQuotaYieldSample) {
  return [
    sample.planType,
    sample.quotaKind,
    sample.limitId ?? '',
    sample.windowKind,
    sample.windowDurationMins ?? '',
  ].join('\u0000');
}

function buildEstimates(samples: readonly CodexUsageQuotaYieldSample[]): CodexUsageQuotaYieldEstimate[] {
  const aggregates = new Map<string, MutableEstimate>();
  for (const sample of samples) {
    const key = estimateKey(sample);
    const existing = aggregates.get(key);
    if (!existing) {
      aggregates.set(key, {
        sample,
        usage: {
          inputTokens: sample.inputTokens,
          cachedInputTokens: sample.cachedInputTokens,
          cacheWriteInputTokens: sample.cacheWriteInputTokens,
          outputTokens: sample.outputTokens,
          reasoningOutputTokens: sample.reasoningOutputTokens,
          totalTokens: sample.totalTokens,
        },
        requestCount: sample.requestCount,
        quotaPercentObserved: sample.quotaPercentConsumed,
        credits: sample.codexCredits ?? 0,
        creditsComplete: sample.codexCredits !== null,
        samples: [sample],
        firstAt: sample.from,
        lastAt: sample.to,
      });
      continue;
    }
    addUsage(existing.usage, sample);
    existing.requestCount = addSafe(existing.requestCount, sample.requestCount);
    existing.quotaPercentObserved += sample.quotaPercentConsumed;
    existing.credits += sample.codexCredits ?? 0;
    existing.creditsComplete &&= sample.codexCredits !== null;
    existing.samples.push(sample);
    if (sample.from < existing.firstAt) existing.firstAt = sample.from;
    if (sample.to > existing.lastAt) existing.lastAt = sample.to;
  }
  return [...aggregates.values()]
    .map((aggregate) => {
      const sample = aggregate.sample;
      const yields = aggregate.samples.map((candidate) => candidate.tokensPerOnePercent);
      return {
        attribution: 'OVERALL' as const,
        planType: sample.planType,
        limitId: sample.limitId,
        quotaKind: sample.quotaKind,
        windowKind: sample.windowKind,
        windowDurationMins: sample.windowDurationMins,
        model: 'all',
        serviceTier: 'ALL' as const,
        tokensPerOnePercent: aggregate.usage.totalTokens / aggregate.quotaPercentObserved,
        medianTokensPerOnePercent: weightedQuantile(aggregate.samples, 0.5),
        medianNonCachedTokensPerOnePercent: weightedQuantile(
          aggregate.samples,
          0.5,
          (candidate) =>
            (Math.max(0, candidate.inputTokens - candidate.cachedInputTokens) + candidate.outputTokens) /
            candidate.quotaPercentConsumed,
        ),
        percentile25TokensPerOnePercent: weightedQuantile(aggregate.samples, 0.25),
        percentile75TokensPerOnePercent: weightedQuantile(aggregate.samples, 0.75),
        minimumTokensPerOnePercent: Math.min(...yields),
        maximumTokensPerOnePercent: Math.max(...yields),
        quotaPercentPerMillionTokens: (aggregate.quotaPercentObserved * 1_000_000) / aggregate.usage.totalTokens,
        codexCredits: aggregate.creditsComplete ? aggregate.credits : null,
        codexCreditsPerOnePercent: aggregate.creditsComplete
          ? aggregate.credits / aggregate.quotaPercentObserved
          : null,
        ...aggregate.usage,
        cachedInputPercent:
          aggregate.usage.inputTokens > 0 ? (aggregate.usage.cachedInputTokens / aggregate.usage.inputTokens) * 100 : 0,
        requestCount: aggregate.requestCount,
        quotaPercentObserved: aggregate.quotaPercentObserved,
        sampleCount: aggregate.samples.length,
        firstAt: aggregate.firstAt,
        lastAt: aggregate.lastAt,
      };
    })
    .sort(
      (left, right) =>
        right.quotaPercentObserved - left.quotaPercentObserved || left.planType.localeCompare(right.planType),
    );
}

export class CodexQuotaYieldAccumulator {
  readonly #coverage: CodexUsageEventCoverage;
  readonly #range: CodexUsageRange;
  readonly #timeZone: string;
  readonly #activeStates = new Map<string, CycleState>();
  readonly #completedStates: CycleState[] = [];
  #staleSnapshotCount = 0;
  #forecastChangedCount = 0;

  constructor(options: AccumulatorOptions) {
    this.#coverage = options.coverage;
    this.#range = options.range;
    this.#timeZone = options.timeZone;
  }

  add(event: CodexUsageInternalEvent) {
    for (const observation of observationsFor(event)) {
      const stream = streamKey(observation);
      let state = this.#activeStates.get(stream);
      if (!state) {
        state = this.#newState(cycleKey(observation), observation);
        this.#activeStates.set(stream, state);
      } else {
        const activeSchedule = resetScheduleBucket(state.resetsAt);
        const observedSchedule = resetScheduleBucket(observation.resetsAt);
        if (observedSchedule < activeSchedule) {
          this.#staleSnapshotCount = addSafe(this.#staleSnapshotCount, 1);
          continue;
        }
        if (observedSchedule > activeSchedule) {
          this.#completedStates.push(state);
          this.#forecastChangedCount = addSafe(this.#forecastChangedCount, 1);
          state = this.#newState(cycleKey(observation), observation);
          this.#activeStates.set(stream, state);
        }
      }
      this.#addObservation(state, observation, event);
    }
  }

  result(): CodexUsageQuotaYieldAnalysis {
    let discardedIncompleteIntervals = 0;
    let unattributedQuotaPercent = 0;
    const states = [...this.#completedStates, ...this.#activeStates.values()];
    const eligibleCycleStates = states
      .flatMap((state) => {
        this.#commitBucketUsage(state);
        const quotaSpan = this.#quotaSpan(state);
        const { quotaPercentConsumed } = quotaSpan;
        if (quotaPercentConsumed <= EPSILON) return [];
        if (!state.usage.totalTokens) {
          discardedIncompleteIntervals = addSafe(discardedIncompleteIntervals, 1);
          unattributedQuotaPercent += quotaPercentConsumed;
          return [];
        }
        return [{ state, cycle: this.#cycle(state, quotaSpan) }];
      })
      .sort(
        (left, right) =>
          left.cycle.observedFrom.localeCompare(right.cycle.observedFrom) ||
          left.cycle.cycleKey.localeCompare(right.cycle.cycleKey),
      );
    const samplesTruncated = eligibleCycleStates.length > MAX_RETURNED_CYCLES;
    const cycleStates = eligibleCycleStates.slice(-MAX_RETURNED_CYCLES);
    const cycles = cycleStates.map(({ cycle }) => cycle);
    const samples = cycleStates.map(({ state, cycle }) => this.#sample(state, cycle));
    const quotaReleasedCount = states.reduce((sum, state) => addSafe(sum, this.#quotaReleaseCount(state)), 0);
    return {
      definition: 'OBSERVED_TOKENS_PER_SUBSCRIPTION_QUOTA_PERCENT',
      calculationBasis: 'OBSERVATION_SEGMENT',
      algorithmVersion: 10,
      timeZone: this.#timeZone,
      defaultGranularity: codexUsageDefaultGranularity(this.#range),
      storedFrom: this.#coverage.storedFrom,
      storedTo: this.#coverage.storedTo,
      storedSessionCount: this.#coverage.storedSessionCount,
      sourceEventCount: this.#coverage.sourceEventCount,
      resetCount: 0,
      confirmedResetCount: 0,
      quotaReleasedCount,
      staleSnapshotCount: this.#staleSnapshotCount,
      streamChangedCount: 0,
      forecastChangedCount: this.#forecastChangedCount,
      eligibleSampleCount: eligibleCycleStates.length,
      samplesTruncated,
      unattributedQuotaPercent,
      discardedIncompleteIntervals,
      discardedMixedModelIntervals: 0,
      discardedMixedTierIntervals: 0,
      discardedUnknownTierIntervals: 0,
      discardedUnknownPlanIntervals: 0,
      discardedUnknownQuotaIntervals: 0,
      discardedStaleSnapshotIntervals: this.#staleSnapshotCount,
      discardedWarmupIntervals: 0,
      discardedNonConsecutiveIntervals: 0,
      resetObservations: [],
      cycles,
      samples,
      estimates: buildEstimates(samples),
      timeSlices: [],
    };
  }

  #newState(key: string, observation: QuotaObservation): CycleState {
    return {
      key,
      observation,
      resetsAt: observation.resetsAt,
      observedFrom: observation.timestamp,
      observedTo: observation.timestamp,
      quotaSnapshots: new Map(),
      pendingBucket: null,
      pendingEvents: [],
      previousUsedPercent: null,
      usage: emptyUsage(),
      requestCount: 0,
      models: new Map(),
      standardEquivalentTokens: 0,
      standardEquivalentNonCachedTokens: 0,
      standardEquivalentApiUsd: 0,
      standardEquivalentComplete: true,
      apiComplete: true,
      credits: 0,
      creditsComplete: true,
    };
  }

  #addObservation(state: CycleState, observation: QuotaObservation, event: CodexUsageInternalEvent) {
    if (observation.timestamp < state.observedFrom) state.observedFrom = observation.timestamp;
    if (observation.timestamp > state.observedTo) state.observedTo = observation.timestamp;
    const observationBucket = Math.floor(Date.parse(observation.timestamp) / OBSERVATION_BUCKET_MS);
    if (state.pendingBucket !== observationBucket) {
      this.#commitBucketUsage(state);
      state.pendingBucket = observationBucket;
    }
    const quotaSnapshot = state.quotaSnapshots.get(observationBucket);
    if (!quotaSnapshot || observation.usedPercent > quotaSnapshot.usedPercent) {
      state.quotaSnapshots.set(observationBucket, { usedPercent: observation.usedPercent });
    }
    if (observation.resetsAt > state.resetsAt) {
      state.resetsAt = observation.resetsAt;
    }
    if (event.usage.totalTokens) state.pendingEvents.push(event);
  }

  #commitBucketUsage(state: CycleState) {
    if (state.pendingBucket === null) return;
    const snapshot = state.quotaSnapshots.get(state.pendingBucket)!;
    // Initial and reset/release minutes establish a baseline. Their usage cannot be paired with a quota delta.
    if (state.previousUsedPercent !== null && snapshot.usedPercent + EPSILON >= state.previousUsedPercent) {
      for (const event of state.pendingEvents) this.#addUsage(state, event);
    }
    state.previousUsedPercent = snapshot.usedPercent;
    state.pendingEvents = [];
    state.pendingBucket = null;
  }

  #addUsage(state: CycleState, event: CodexUsageInternalEvent) {
    addUsage(state.usage, event.usage);
    state.requestCount = addSafe(state.requestCount, 1);
    const model = normalizeCodexUsageModel(event.model) || 'unknown';
    const modelTierKey = `${model}\u0000${event.serviceTier}`;
    const modelUsage = state.models.get(modelTierKey) ?? {
      model,
      serviceTier: event.serviceTier,
      inferredServiceTierTokens: 0,
      totalTokens: 0,
      requestCount: 0,
    };
    if (event.serviceTierInferred) {
      modelUsage.inferredServiceTierTokens = addSafe(modelUsage.inferredServiceTierTokens, event.usage.totalTokens);
    }
    modelUsage.totalTokens = addSafe(modelUsage.totalTokens, event.usage.totalTokens);
    modelUsage.requestCount = addSafe(modelUsage.requestCount, 1);
    state.models.set(modelTierKey, modelUsage);
    const speedMultiplier = codexUsageStandardEquivalentMultiplier(model, event.serviceTier);
    const nonCachedTokens =
      Math.max(0, event.usage.inputTokens - event.usage.cachedInputTokens) + event.usage.outputTokens;
    state.standardEquivalentComplete &&= speedMultiplier !== null;
    state.standardEquivalentTokens = addSafe(
      state.standardEquivalentTokens,
      event.usage.totalTokens * (speedMultiplier ?? 0),
    );
    state.standardEquivalentNonCachedTokens = addSafe(
      state.standardEquivalentNonCachedTokens,
      nonCachedTokens * (speedMultiplier ?? 0),
    );
    const valuation = estimateCodexUsage(model, event.usage, event.serviceTier, event.timestamp);
    state.standardEquivalentApiUsd += (valuation.apiEquivalentUsd ?? 0) * (speedMultiplier ?? 0);
    state.apiComplete &&= valuation.apiEquivalentUsd !== null;
    state.credits += valuation.codexCredits ?? 0;
    state.creditsComplete &&= valuation.codexCredits !== null;
  }

  #quotaSpan(state: CycleState) {
    const snapshots = [...state.quotaSnapshots.entries()].sort((left, right) => left[0] - right[0]);
    const baselineUsedPercent = snapshots[0]?.[1].usedPercent ?? 0;
    const maximumUsedPercent = snapshots.reduce(
      (maximum, [, snapshot]) => Math.max(maximum, snapshot.usedPercent),
      baselineUsedPercent,
    );
    // A reset/release starts a new baseline, not a negative charge or an assumed full 100% spend.
    let quotaPercentConsumed = 0;
    for (let index = 1; index < snapshots.length; index += 1) {
      quotaPercentConsumed += Math.max(0, snapshots[index]![1].usedPercent - snapshots[index - 1]![1].usedPercent);
    }
    return { baselineUsedPercent, maximumUsedPercent, quotaPercentConsumed };
  }

  #quotaReleaseCount(state: CycleState) {
    const snapshots = [...state.quotaSnapshots.entries()].sort((left, right) => left[0] - right[0]);
    let released = 0;
    for (let index = 1; index < snapshots.length; index += 1) {
      if (snapshots[index]![1].usedPercent + EPSILON < snapshots[index - 1]![1].usedPercent) {
        released = addSafe(released, 1);
      }
    }
    return released;
  }

  #cycle(
    state: CycleState,
    {
      baselineUsedPercent,
      maximumUsedPercent,
      quotaPercentConsumed,
    }: {
      baselineUsedPercent: number;
      maximumUsedPercent: number;
      quotaPercentConsumed: number;
    },
  ): CodexUsageQuotaCycle {
    const nonCachedTokens =
      Math.max(0, state.usage.inputTokens - state.usage.cachedInputTokens) + state.usage.outputTokens;
    return {
      cycleKey: state.key,
      planType: state.observation.planType,
      limitId: state.observation.limitId,
      quotaKind: state.observation.quotaKind,
      windowKind: state.observation.windowKind,
      windowDurationMins: state.observation.windowDurationMins,
      startsAt: state.observedFrom,
      resetsAt: state.resetsAt,
      observedFrom: state.observedFrom,
      observedTo: state.observedTo,
      baselineUsedPercent,
      maximumUsedPercent,
      quotaPercentConsumed,
      requestCount: state.requestCount,
      ...state.usage,
      standardEquivalentTokens: state.standardEquivalentComplete ? state.standardEquivalentTokens : null,
      standardEquivalentApiUsd:
        state.standardEquivalentComplete && state.apiComplete ? state.standardEquivalentApiUsd : null,
      tokensPerOnePercent: state.usage.totalTokens / quotaPercentConsumed,
      nonCachedTokensPerOnePercent: nonCachedTokens / quotaPercentConsumed,
      standardEquivalentTokensPerOnePercent: state.standardEquivalentComplete
        ? state.standardEquivalentTokens / quotaPercentConsumed
        : null,
      standardEquivalentNonCachedTokensPerOnePercent: state.standardEquivalentComplete
        ? state.standardEquivalentNonCachedTokens / quotaPercentConsumed
        : null,
      cachedInputPercent:
        state.usage.inputTokens > 0 ? (state.usage.cachedInputTokens / state.usage.inputTokens) * 100 : 0,
      modelShares: [...state.models.values()]
        .map((usage) => ({
          model: usage.model,
          serviceTier: usage.serviceTier,
          inferredServiceTierTokens: usage.inferredServiceTierTokens,
          totalTokens: usage.totalTokens,
          tokenPercent: (usage.totalTokens / state.usage.totalTokens) * 100,
          requestCount: usage.requestCount,
        }))
        .sort(
          (left, right) =>
            right.totalTokens - left.totalTokens ||
            left.model.localeCompare(right.model) ||
            left.serviceTier.localeCompare(right.serviceTier),
        ),
    };
  }

  #sample(state: CycleState, cycle: CodexUsageQuotaCycle): CodexUsageQuotaYieldSample {
    const codexCredits = state.creditsComplete ? state.credits : null;
    return {
      attribution: 'OVERALL',
      planType: cycle.planType,
      limitId: cycle.limitId,
      quotaKind: cycle.quotaKind,
      windowKind: cycle.windowKind,
      windowDurationMins: cycle.windowDurationMins,
      model: 'all',
      serviceTier: 'ALL',
      from: cycle.observedFrom,
      to: cycle.observedTo,
      resetsAt: cycle.resetsAt,
      quotaPercentConsumed: cycle.quotaPercentConsumed,
      requestCount: cycle.requestCount,
      inputTokens: cycle.inputTokens,
      cachedInputTokens: cycle.cachedInputTokens,
      cacheWriteInputTokens: cycle.cacheWriteInputTokens,
      outputTokens: cycle.outputTokens,
      reasoningOutputTokens: cycle.reasoningOutputTokens,
      totalTokens: cycle.totalTokens,
      tokensPerOnePercent: cycle.tokensPerOnePercent,
      quotaPercentPerMillionTokens: (cycle.quotaPercentConsumed * 1_000_000) / cycle.totalTokens,
      codexCredits,
      codexCreditsPerOnePercent: codexCredits === null ? null : codexCredits / cycle.quotaPercentConsumed,
    };
  }
}
