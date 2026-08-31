import type {
  CodexUsageSessionLengthAnalysis,
  CodexUsageSessionLengthBucket,
  CodexUsageSessionLengthComparison,
  CodexUsageSessionLengthRange,
  CodexUsageSessionSource,
} from '@/shared/contracts/codex-usage';
import type {
  CodexUsageSessionSourceRecord,
  CodexUsageStoredChatTurn,
} from '@/main/extensions/codex-usage-investigator/cache-records';
import { normalizeCodexUsageModel } from '@/main/extensions/codex-usage-investigator/pricing';
import type {
  CodexUsageInternalEvent,
  CodexUsageInternalRow,
} from '@/main/extensions/codex-usage-investigator/session-reader';

const TARGET_SESSIONS_PER_BUCKET = 5;
const SIGNAL_MINIMUM_SESSIONS = 5;
const SIGNAL_MINIMUM_PRICED_SESSIONS = 5;
const MAX_COMPARISONS = 1_000;
const EPSILON = 1e-12;

interface SessionState extends CodexUsageSessionSourceRecord {
  ownedTurnCount: number;
  inheritedTurnCount: number;
  openOwnedTurnCount: number;
  lastTerminalMs: number | null;
  models: Set<string>;
  serviceTiers: Set<CodexUsageInternalEvent['serviceTier']>;
  uncachedInputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  maximumInputTokens: number;
  apiEquivalentUsd: number;
  apiPriceAvailable: boolean;
  usageEventCount: number;
}

interface SessionSample {
  source: CodexUsageSessionSource;
  model: string;
  chatTurns: number;
  uncachedInputTokensPerTurn: number;
  cachedInputTokensPerTurn: number;
  cacheWriteInputTokensPerTurn: number;
  outputTokensPerTurn: number;
  reasoningOutputTokensPerTurn: number;
  totalTokensPerTurn: number;
  apiEquivalentUsdPerTurn: number | null;
  peakContextTokens: number;
  contextCompactionCount: number;
}

interface ComparisonState {
  source: CodexUsageSessionSource;
  model: string;
  sessions: SessionSample[];
}

interface SessionTurnGroup {
  chatTurns: number;
  sessions: SessionSample[];
}

function addSafe(left: number, right: number) {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

function percentile(values: readonly number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function median(values: readonly number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

function mean(values: readonly number[]) {
  if (!values.length) return 0;
  return values.reduce(addSafe, 0) / values.length;
}

function inputs(row: CodexUsageInternalRow) {
  const cachedInputTokens = Math.min(row.usage.cachedInputTokens, row.usage.inputTokens);
  const cacheWriteInputTokens = Math.min(
    row.usage.cacheWriteInputTokens,
    Math.max(0, row.usage.inputTokens - cachedInputTokens),
  );
  return {
    cachedInputTokens,
    cacheWriteInputTokens,
    uncachedInputTokens: Math.max(0, row.usage.inputTokens - cachedInputTokens - cacheWriteInputTokens),
  };
}

function sessionSource(state: SessionState): CodexUsageSessionSource | null {
  if (state.threadSource === 'SUBAGENT') return 'SUBAGENT';
  if (state.threadSource !== 'USER') return null;
  return state.inheritedTurnCount > 0 ? 'USER_FORK' : 'USER_DIRECT';
}

function rangeFromBucket(bucket: CodexUsageSessionLengthBucket): CodexUsageSessionLengthRange {
  return { minimumTurns: bucket.minimumTurns, maximumTurns: bucket.maximumTurns };
}

function equalCost(left: number, right: number) {
  return Math.abs(left - right) <= Math.max(EPSILON, Math.abs(right) * EPSILON);
}

function bucketResult(
  range: CodexUsageSessionLengthRange,
  sessions: readonly SessionSample[],
): CodexUsageSessionLengthBucket {
  const priced = sessions.flatMap(({ apiEquivalentUsdPerTurn }) =>
    apiEquivalentUsdPerTurn === null ? [] : [apiEquivalentUsdPerTurn],
  );
  return {
    ...range,
    sessionCount: sessions.length,
    totalChatTurns: sessions.reduce((sum, session) => addSafe(sum, session.chatTurns), 0),
    sessionTurnDistribution: sessionTurnGroups(sessions).map(({ chatTurns, sessions: groupedSessions }) => ({
      chatTurns,
      sessionCount: groupedSessions.length,
    })),
    medianUncachedInputTokensPerTurn: median(sessions.map((session) => session.uncachedInputTokensPerTurn)),
    medianCachedInputTokensPerTurn: median(sessions.map((session) => session.cachedInputTokensPerTurn)),
    medianCacheWriteInputTokensPerTurn: median(sessions.map((session) => session.cacheWriteInputTokensPerTurn)),
    medianOutputTokensPerTurn: median(sessions.map((session) => session.outputTokensPerTurn)),
    medianReasoningOutputTokensPerTurn: median(sessions.map((session) => session.reasoningOutputTokensPerTurn)),
    medianTotalTokensPerTurn: median(sessions.map((session) => session.totalTokensPerTurn)),
    medianApiEquivalentUsdPerTurn: priced.length ? median(priced) : null,
    averageContextCompactions: mean(sessions.map((session) => session.contextCompactionCount)),
    apiPricedSessionCount: priced.length,
    apiPricingCoveragePercent: sessions.length ? (priced.length / sessions.length) * 100 : 0,
    percentile25PeakContextTokens: percentile(
      sessions.map((session) => session.peakContextTokens),
      0.25,
    ),
    percentile75PeakContextTokens: percentile(
      sessions.map((session) => session.peakContextTokens),
      0.75,
    ),
  };
}

function sessionTurnGroups(sessions: readonly SessionSample[]) {
  const grouped = new Map<number, SessionSample[]>();
  for (const session of sessions) {
    const group = grouped.get(session.chatTurns);
    if (group) group.push(session);
    else grouped.set(session.chatTurns, [session]);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([chatTurns, groupedSessions]): SessionTurnGroup => ({ chatTurns, sessions: groupedSessions }));
}

function partitionSessionGroups(groups: readonly SessionTurnGroup[], bucketCount: number, sessionCount: number) {
  if (bucketCount === 1) return [groups.flatMap((group) => group.sessions)];
  const result: SessionSample[][] = [];
  let firstGroup = 0;
  let assignedSessions = 0;
  for (let bucketIndex = 0; bucketIndex < bucketCount - 1; bucketIndex += 1) {
    const remainingBuckets = bucketCount - bucketIndex - 1;
    const maximumLastGroup = groups.length - remainingBuckets - 1;
    const targetBucketSessions = (sessionCount - assignedSessions) / (bucketCount - bucketIndex);
    let candidateSessions = 0;
    let bestLastGroup = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let lastGroup = firstGroup; lastGroup <= maximumLastGroup; lastGroup += 1) {
      candidateSessions += groups[lastGroup]?.sessions.length ?? 0;
      const distance = Math.abs(candidateSessions - targetBucketSessions);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestLastGroup = lastGroup;
      }
    }
    if (bestLastGroup < firstGroup) return null;
    const bucketSessions = groups.slice(firstGroup, bestLastGroup + 1).flatMap((group) => group.sessions);
    result.push(bucketSessions);
    assignedSessions += bucketSessions.length;
    firstGroup = bestLastGroup + 1;
  }
  const lastBucket = groups.slice(firstGroup).flatMap((group) => group.sessions);
  result.push(lastBucket);
  return result;
}

function dynamicSessionBuckets(sessions: readonly SessionSample[]) {
  const groups = sessionTurnGroups(sessions);
  const bucketCount = Math.min(
    groups.length,
    Math.max(1, Math.ceil(sessions.length / TARGET_SESSIONS_PER_BUCKET)),
    Math.max(1, Math.ceil(Math.log2(sessions.length)) + 1),
  );
  return partitionSessionGroups(groups, bucketCount, sessions.length) ?? [groups.flatMap((group) => group.sessions)];
}

function comparisonResult(comparison: ComparisonState): CodexUsageSessionLengthComparison {
  const buckets = dynamicSessionBuckets(comparison.sessions).map((sessions) => {
    const chatTurns = sessions.map((session) => session.chatTurns);
    return bucketResult({ minimumTurns: Math.min(...chatTurns), maximumTurns: Math.max(...chatTurns) }, sessions);
  });
  const tokenBuckets = buckets.filter(({ sessionCount }) => sessionCount >= SIGNAL_MINIMUM_SESSIONS);
  const lowestToken =
    tokenBuckets.length >= 2
      ? Math.min(...tokenBuckets.map(({ medianTotalTokensPerTurn }) => medianTotalTokensPerTurn))
      : null;
  const lowestMedianTokenRanges =
    lowestToken === null
      ? []
      : tokenBuckets
          .filter(({ medianTotalTokensPerTurn }) => equalCost(medianTotalTokensPerTurn, lowestToken))
          .map(rangeFromBucket);
  const apiBuckets = buckets.filter(
    (bucket): bucket is CodexUsageSessionLengthBucket & { medianApiEquivalentUsdPerTurn: number } =>
      bucket.apiPricedSessionCount >= SIGNAL_MINIMUM_PRICED_SESSIONS && bucket.medianApiEquivalentUsdPerTurn !== null,
  );
  const lowestApi =
    apiBuckets.length >= 2
      ? Math.min(...apiBuckets.map(({ medianApiEquivalentUsdPerTurn }) => medianApiEquivalentUsdPerTurn))
      : null;
  const lowestMedianApiCostRanges =
    lowestApi === null
      ? []
      : apiBuckets
          .filter(({ medianApiEquivalentUsdPerTurn }) => equalCost(medianApiEquivalentUsdPerTurn, lowestApi))
          .map(rangeFromBucket);
  let lastLowestIndex = -1;
  buckets.forEach(({ medianApiEquivalentUsdPerTurn, apiPricedSessionCount }, index) => {
    if (
      lowestApi !== null &&
      apiPricedSessionCount >= SIGNAL_MINIMUM_PRICED_SESSIONS &&
      medianApiEquivalentUsdPerTurn !== null &&
      equalCost(medianApiEquivalentUsdPerTurn, lowestApi)
    ) {
      lastLowestIndex = index;
    }
  });
  let sustainedApiCostIncrease: CodexUsageSessionLengthComparison['sustainedApiCostIncrease'] = null;
  for (let index = lastLowestIndex + 1; index < buckets.length - 1 && lowestApi !== null; index += 1) {
    const previous = buckets[index - 1];
    const current = buckets[index];
    const next = buckets[index + 1];
    if (!previous || !current || !next) continue;
    if (
      [previous, current, next].some(
        (bucket) =>
          bucket.apiPricedSessionCount < SIGNAL_MINIMUM_PRICED_SESSIONS ||
          bucket.medianApiEquivalentUsdPerTurn === null,
      )
    ) {
      continue;
    }
    const previousCost = previous.medianApiEquivalentUsdPerTurn;
    const currentCost = current.medianApiEquivalentUsdPerTurn;
    const nextCost = next.medianApiEquivalentUsdPerTurn;
    if (previousCost === null || currentCost === null || nextCost === null) continue;
    if (currentCost > previousCost && nextCost > currentCost) {
      sustainedApiCostIncrease = {
        minimumTurns: current.minimumTurns,
        maximumTurns: current.maximumTurns,
        relativeToLowestPercent: lowestApi > 0 ? ((currentCost - lowestApi) / lowestApi) * 100 : 0,
      };
      break;
    }
  }
  const chatTurns = comparison.sessions.map((session) => session.chatTurns);
  const apiPricedSessionCount = comparison.sessions.filter(
    ({ apiEquivalentUsdPerTurn }) => apiEquivalentUsdPerTurn !== null,
  ).length;
  return {
    source: comparison.source,
    model: comparison.model,
    sessionCount: comparison.sessions.length,
    totalChatTurns: chatTurns.reduce(addSafe, 0),
    medianSessionTurns: median(chatTurns),
    percentile90SessionTurns: percentile(chatTurns, 0.9),
    maximumSessionTurns: Math.max(0, ...chatTurns),
    averageContextCompactions: mean(comparison.sessions.map((session) => session.contextCompactionCount)),
    apiPricedSessionCount,
    apiPricingCoveragePercent: comparison.sessions.length
      ? (apiPricedSessionCount / comparison.sessions.length) * 100
      : 0,
    buckets,
    lowestMedianTokenRanges,
    lowestMedianApiCostRanges,
    sustainedApiCostIncrease,
  };
}

function initialSession(source: CodexUsageSessionSourceRecord): SessionState {
  return {
    ...source,
    ownedTurnCount: 0,
    inheritedTurnCount: 0,
    openOwnedTurnCount: 0,
    lastTerminalMs: null,
    models: new Set(),
    serviceTiers: new Set(),
    uncachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    maximumInputTokens: 0,
    apiEquivalentUsd: 0,
    apiPriceAvailable: true,
    usageEventCount: 0,
  };
}

function uuidV7Timestamp(value: string) {
  const match = value.match(/^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  if (!match) return null;
  const timestamp = Number.parseInt(`${match[1]}${match[2]}`, 16);
  return Number.isSafeInteger(timestamp) ? timestamp : null;
}

function belongsToCreatedThread(turn: CodexUsageStoredChatTurn) {
  const createdAt = uuidV7Timestamp(turn.turnId);
  return createdAt === null || turn.threadCreatedMs === 0 || createdAt >= turn.threadCreatedMs;
}

export class CodexSessionLengthAccumulator {
  readonly #fromEpoch: number | null;
  readonly #toEpoch: number;
  readonly #sessions = new Map<string, SessionState>();
  readonly #ownedTurnIds = new Set<string>();

  constructor(fromEpoch: number | null, toEpoch: number) {
    this.#fromEpoch = fromEpoch;
    this.#toEpoch = toEpoch;
  }

  addSource(source: CodexUsageSessionSourceRecord) {
    this.#sessions.set(source.sessionId, initialSession(source));
  }

  addChatTurn(turn: CodexUsageStoredChatTurn) {
    const session = this.#sessions.get(turn.sessionId);
    if (!session) return;
    if (!belongsToCreatedThread(turn) || this.#ownedTurnIds.has(turn.turnId)) {
      session.inheritedTurnCount = addSafe(session.inheritedTurnCount, 1);
      return;
    }
    this.#ownedTurnIds.add(turn.turnId);
    session.ownedTurnCount = addSafe(session.ownedTurnCount, 1);
    if (turn.terminalMs === null || turn.terminalState === null) {
      session.openOwnedTurnCount = addSafe(session.openOwnedTurnCount, 1);
      return;
    }
    session.lastTerminalMs = Math.max(session.lastTerminalMs ?? 0, turn.terminalMs);
  }

  addEvent(event: CodexUsageInternalEvent, row: CodexUsageInternalRow) {
    const session = this.#sessions.get(event.sessionId);
    if (!session || !event.usage.totalTokens) return;
    const input = inputs(row);
    const model = normalizeCodexUsageModel(event.model);
    session.models.add(model || 'unknown');
    session.serviceTiers.add(event.serviceTier);
    session.uncachedInputTokens = addSafe(session.uncachedInputTokens, input.uncachedInputTokens);
    session.cachedInputTokens = addSafe(session.cachedInputTokens, input.cachedInputTokens);
    session.cacheWriteInputTokens = addSafe(session.cacheWriteInputTokens, input.cacheWriteInputTokens);
    session.outputTokens = addSafe(session.outputTokens, row.usage.outputTokens);
    session.reasoningOutputTokens = addSafe(session.reasoningOutputTokens, row.usage.reasoningOutputTokens);
    session.totalTokens = addSafe(session.totalTokens, row.usage.totalTokens);
    session.maximumInputTokens = Math.max(session.maximumInputTokens, row.usage.inputTokens);
    session.usageEventCount = addSafe(session.usageEventCount, 1);
    if (row.apiEquivalentUsd === null) session.apiPriceAvailable = false;
    else session.apiEquivalentUsd += row.apiEquivalentUsd;
  }

  result(): CodexUsageSessionLengthAnalysis {
    const comparisons = new Map<string, ComparisonState>();
    let rangeSessionCount = 0;
    let comparisonSessionCount = 0;
    let excludedUnsupportedSourceSessionCount = 0;
    let excludedIncompleteSessionCount = 0;
    let excludedNoOwnedTurnSessionCount = 0;
    let excludedOpenSessionCount = 0;
    let excludedOutsideRangeSessionCount = 0;
    let excludedNoUsageSessionCount = 0;
    let excludedUnknownModelSessionCount = 0;
    let excludedMixedModelSessionCount = 0;
    let mixedServiceTierSessionCount = 0;
    let unknownServiceTierSessionCount = 0;

    for (const state of this.#sessions.values()) {
      const source = sessionSource(state);
      if (!source) {
        excludedUnsupportedSourceSessionCount += 1;
        continue;
      }
      if (!state.ownedTurnCount) {
        excludedNoOwnedTurnSessionCount += 1;
        continue;
      }
      if (state.openOwnedTurnCount || state.lastTerminalMs === null) {
        excludedOpenSessionCount += 1;
        continue;
      }
      if (
        state.lastTerminalMs > this.#toEpoch ||
        (this.#fromEpoch !== null && state.lastTerminalMs < this.#fromEpoch)
      ) {
        excludedOutsideRangeSessionCount += 1;
        continue;
      }
      rangeSessionCount += 1;
      if (
        !state.turnMetadataComplete ||
        state.invalidRecords > 0 ||
        state.oversizedRecords > 0 ||
        state.hasUnassignedUsage
      ) {
        excludedIncompleteSessionCount += 1;
        continue;
      }
      if (!state.usageEventCount || !state.totalTokens) {
        excludedNoUsageSessionCount += 1;
        continue;
      }
      if (state.models.has('unknown')) {
        excludedUnknownModelSessionCount += 1;
        continue;
      }
      if (state.models.size !== 1) {
        excludedMixedModelSessionCount += 1;
        continue;
      }
      if (state.serviceTiers.size > 1) mixedServiceTierSessionCount += 1;
      if (state.serviceTiers.has('UNKNOWN')) unknownServiceTierSessionCount += 1;
      const model = [...state.models][0];
      if (!model) continue;
      const turns = state.ownedTurnCount;
      const sample: SessionSample = {
        source,
        model,
        chatTurns: turns,
        uncachedInputTokensPerTurn: state.uncachedInputTokens / turns,
        cachedInputTokensPerTurn: state.cachedInputTokens / turns,
        cacheWriteInputTokensPerTurn: state.cacheWriteInputTokens / turns,
        outputTokensPerTurn: state.outputTokens / turns,
        reasoningOutputTokensPerTurn: state.reasoningOutputTokens / turns,
        totalTokensPerTurn: state.totalTokens / turns,
        apiEquivalentUsdPerTurn: state.apiPriceAvailable ? state.apiEquivalentUsd / turns : null,
        peakContextTokens: state.maximumInputTokens,
        contextCompactionCount: state.contextCompactionCount,
      };
      const key = `${source}\u0000${model}`;
      let comparison = comparisons.get(key);
      if (!comparison) {
        if (comparisons.size >= MAX_COMPARISONS) continue;
        comparison = { source, model, sessions: [] };
        comparisons.set(key, comparison);
      }
      comparison.sessions.push(sample);
      comparisonSessionCount += 1;
    }

    return {
      definition: 'COMPLETE_SESSION_CHAT_TURNS',
      algorithmVersion: 3,
      comparisonScope: 'SESSION_SOURCE_AND_SINGLE_NORMALIZED_MODEL',
      bucketStrategy: 'DYNAMIC_EQUAL_SESSION_COUNT',
      rangeAssignment: 'LAST_TERMINAL_OWNED_CHAT_TURN',
      contextDefinition: 'SESSION_MAXIMUM_INPUT_TOKENS',
      signalMinimumSessions: SIGNAL_MINIMUM_SESSIONS,
      signalMinimumPricedSessions: SIGNAL_MINIMUM_PRICED_SESSIONS,
      sourceSessionCount: this.#sessions.size,
      rangeSessionCount,
      comparisonSessionCount,
      excludedUnsupportedSourceSessionCount,
      excludedIncompleteSessionCount,
      excludedNoOwnedTurnSessionCount,
      excludedOpenSessionCount,
      excludedOutsideRangeSessionCount,
      excludedNoUsageSessionCount,
      excludedUnknownModelSessionCount,
      excludedMixedModelSessionCount,
      mixedServiceTierSessionCount,
      unknownServiceTierSessionCount,
      comparisons: [...comparisons.values()]
        .map(comparisonResult)
        .sort(
          (left, right) =>
            right.sessionCount - left.sessionCount ||
            left.source.localeCompare(right.source) ||
            left.model.localeCompare(right.model),
        ),
    };
  }
}
