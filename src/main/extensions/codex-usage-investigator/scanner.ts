import { createHash } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {
  codexUsageDailyBreakdownSchema,
  codexUsageModelBreakdownSchema,
  codexUsageQuotaYieldAnalysisSchema,
  codexUsageTokenTotalsSchema,
} from '@/shared/contracts/codex-usage';
import type {
  CodexUsageDailyBreakdown,
  CodexUsageGranularity,
  CodexUsageInvestigation,
  CodexUsageModelBreakdown,
  CodexUsageQuotaYieldAnalysis,
  CodexUsageRange,
  CodexUsageScanProgress,
  CodexUsageTokenTotals,
  CodexUsageWarningCode,
} from '@/shared/contracts/codex-usage';
import { codexUsageLocalDateKey, codexUsageRangeStartEpoch } from '@/shared/codex-usage-time';
import {
  CODEX_USAGE_PRICING_BASIS,
  type CodexUsageBreakdown,
  estimateCodexUsage,
} from '@/main/extensions/codex-usage-investigator/pricing';
import { CodexQuotaYieldAccumulator } from '@/main/extensions/codex-usage-investigator/quota-yield';
import {
  codexUsageInternalRowSchema,
  readCodexUsageSession,
  type CodexUsageInternalEvent,
  type CodexUsageInternalRow,
} from '@/main/extensions/codex-usage-investigator/session-reader';
import {
  discoverCodexUsageFromThreadIndex,
  type IndexedCodexUsageFile,
} from '@/main/extensions/codex-usage-investigator/thread-index';
import type { CodexUsageCacheDatabase } from '@/main/extensions/codex-usage-investigator/cache-database';

const MAX_FILES = 100_000;
const MAX_EXPORT_ROWS = 100_000;
const DISCOVERY_STAT_CONCURRENCY = 12;
const PROCESSED_ANALYSIS_VERSION = 7;
const safeIntegerSchema = z.number().int().nonnegative().safe();

const processedSnapshotSchema = z
  .object({
    sessionCount: safeIntegerSchema,
    requestCount: safeIntegerSchema,
    totals: codexUsageTokenTotalsSchema,
    models: z.array(codexUsageModelBreakdownSchema).max(1_000),
    days: z.array(codexUsageDailyBreakdownSchema).max(10_000),
    quotaYield: codexUsageQuotaYieldAnalysisSchema,
    exportRows: z.array(codexUsageInternalRowSchema).max(MAX_EXPORT_ROWS),
    exportRowsTruncated: z.boolean(),
  })
  .strict();

type ProcessedSnapshot = z.infer<typeof processedSnapshotSchema>;

type CandidateFile = IndexedCodexUsageFile;

interface DiscoveryResult {
  files: CandidateFile[];
  skipped: number;
  availableRoots: number;
  sourceMode: 'CODEX_DATABASE' | 'FILESYSTEM_FALLBACK';
}

interface MutableAggregate {
  usage: CodexUsageBreakdown;
  requestCount: number;
  sessions: Set<string>;
  longContextRequestCount: number;
  apiEquivalentUsd: number;
  hasApiEquivalent: boolean;
  apiCacheSavingsUsd: number;
  hasApiCacheSavings: boolean;
  codexCredits: number;
  hasCodexCredits: boolean;
  apiPricedTokens: number;
  creditPricedTokens: number;
}

export interface CodexUsageScanResult {
  investigation: CodexUsageInvestigation;
  exportRows: CodexUsageInternalRow[];
}

interface ScanOptions {
  investigationId: string;
  range: CodexUsageRange;
  timeZone: string;
  granularity: CodexUsageGranularity;
  fromEpoch: number | null;
  toEpoch: number;
  cache: CodexUsageCacheDatabase;
  signal?: AbortSignal;
  onProgress?: (progress: CodexUsageScanProgress) => void;
  onCheckpoint?: (progress: CodexUsageScanProgress) => void;
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

function emptyAggregate(): MutableAggregate {
  return {
    usage: emptyUsage(),
    requestCount: 0,
    sessions: new Set(),
    longContextRequestCount: 0,
    apiEquivalentUsd: 0,
    hasApiEquivalent: false,
    apiCacheSavingsUsd: 0,
    hasApiCacheSavings: false,
    codexCredits: 0,
    hasCodexCredits: false,
    apiPricedTokens: 0,
    creditPricedTokens: 0,
  };
}

function addSafe(left: number, right: number) {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw Object.assign(new Error('Codex usage scan cancelled'), { name: 'AbortError' });
  }
}

function addUsage(target: CodexUsageBreakdown, usage: CodexUsageBreakdown) {
  target.inputTokens = addSafe(target.inputTokens, usage.inputTokens);
  target.cachedInputTokens = addSafe(target.cachedInputTokens, usage.cachedInputTokens);
  target.cacheWriteInputTokens = addSafe(target.cacheWriteInputTokens, usage.cacheWriteInputTokens);
  target.outputTokens = addSafe(target.outputTokens, usage.outputTokens);
  target.reasoningOutputTokens = addSafe(target.reasoningOutputTokens, usage.reasoningOutputTokens);
  target.totalTokens = addSafe(target.totalTokens, usage.totalTokens);
}

function mergeRow(target: MutableAggregate, row: CodexUsageInternalRow) {
  addUsage(target.usage, row.usage);
  target.requestCount = addSafe(target.requestCount, row.requestCount);
  target.sessions.add(row.sessionId);
  target.longContextRequestCount = addSafe(target.longContextRequestCount, row.longContextRequestCount);
  target.apiPricedTokens = addSafe(target.apiPricedTokens, row.apiPricedTokens);
  target.creditPricedTokens = addSafe(target.creditPricedTokens, row.creditPricedTokens);
  if (row.apiEquivalentUsd !== null) {
    target.apiEquivalentUsd += row.apiEquivalentUsd;
    target.hasApiEquivalent = true;
  }
  if (row.apiCacheSavingsUsd !== null) {
    target.apiCacheSavingsUsd += row.apiCacheSavingsUsd;
    target.hasApiCacheSavings = true;
  }
  if (row.codexCredits !== null) {
    target.codexCredits += row.codexCredits;
    target.hasCodexCredits = true;
  }
}

function addNullable(left: number | null, right: number | null) {
  if (right === null) return left;
  return (left ?? 0) + right;
}

function rowFromEvent(event: CodexUsageInternalEvent, timeZone: string): CodexUsageInternalRow {
  const estimate = estimateCodexUsage(event.model, event.usage);
  return {
    sessionId: event.sessionId,
    date: codexUsageLocalDateKey(event.timestamp, timeZone),
    model: event.model,
    serviceTier: event.serviceTier,
    quotaKind: event.quotaKind,
    firstAt: event.timestamp,
    lastAt: event.timestamp,
    requestCount: 1,
    usage: { ...event.usage },
    apiEquivalentUsd: estimate.apiEquivalentUsd,
    apiCacheSavingsUsd: estimate.apiCacheSavingsUsd,
    codexCredits: estimate.codexCredits,
    apiPricedTokens: estimate.apiPricedTokens,
    creditPricedTokens: estimate.creditPricedTokens,
    longContextRequestCount: estimate.longContext ? 1 : 0,
  };
}

function mergeInternalRow(target: CodexUsageInternalRow, row: CodexUsageInternalRow) {
  addUsage(target.usage, row.usage);
  if (row.firstAt < target.firstAt) target.firstAt = row.firstAt;
  if (row.lastAt > target.lastAt) target.lastAt = row.lastAt;
  target.requestCount = addSafe(target.requestCount, row.requestCount);
  target.apiEquivalentUsd = addNullable(target.apiEquivalentUsd, row.apiEquivalentUsd);
  target.apiCacheSavingsUsd = addNullable(target.apiCacheSavingsUsd, row.apiCacheSavingsUsd);
  target.codexCredits = addNullable(target.codexCredits, row.codexCredits);
  target.apiPricedTokens = addSafe(target.apiPricedTokens, row.apiPricedTokens);
  target.creditPricedTokens = addSafe(target.creditPricedTokens, row.creditPricedTokens);
  target.longContextRequestCount = addSafe(target.longContextRequestCount, row.longContextRequestCount);
}

function totalsFromAggregate(aggregate: MutableAggregate): CodexUsageTokenTotals {
  const empty = aggregate.requestCount === 0;
  return {
    ...aggregate.usage,
    apiEquivalentUsd: empty ? 0 : aggregate.hasApiEquivalent ? aggregate.apiEquivalentUsd : null,
    apiCacheSavingsUsd: empty ? 0 : aggregate.hasApiCacheSavings ? aggregate.apiCacheSavingsUsd : null,
    codexCredits: empty ? 0 : aggregate.hasCodexCredits ? aggregate.codexCredits : null,
    apiPricedTokens: aggregate.apiPricedTokens,
    creditPricedTokens: aggregate.creditPricedTokens,
  };
}

export function codexUsageRangeStart(range: CodexUsageRange, toEpoch: number, timeZone: string) {
  return codexUsageRangeStartEpoch(range, toEpoch, timeZone);
}

function containsForbiddenPathSegment(candidate: string) {
  return path
    .resolve(candidate)
    .split(path.sep)
    .some((segment) => segment.toLowerCase().includes('trash'));
}

function sessionIdFor(filePath: string, fileName: string) {
  const uuids = [...fileName.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi)];
  const uuid = uuids.at(-1)?.[0];
  return uuid?.toLowerCase() ?? createHash('sha256').update(filePath).digest('hex').slice(0, 32);
}

async function statCandidates(paths: readonly string[], signal?: AbortSignal) {
  const candidates: CandidateFile[] = [];
  let skipped = 0;
  for (let offset = 0; offset < paths.length; offset += DISCOVERY_STAT_CONCURRENCY) {
    throwIfAborted(signal);
    const batch = paths.slice(offset, offset + DISCOVERY_STAT_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (filePath) => {
        try {
          const metadata = await lstat(filePath, { bigint: true });
          if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
          if (metadata.size > BigInt(Number.MAX_SAFE_INTEGER)) return null;
          return {
            filePath,
            sessionId: sessionIdFor(filePath, path.basename(filePath)),
            fallbackModel: null,
            size: Number(metadata.size),
            mtimeMs: Number(metadata.mtimeNs / 1_000_000n),
            mtimeNs: metadata.mtimeNs.toString(),
            ctimeNs: metadata.ctimeNs.toString(),
          } satisfies CandidateFile;
        } catch {
          return null;
        }
      }),
    );
    for (const result of results) {
      if (result) candidates.push(result);
      else skipped += 1;
    }
  }
  return { candidates, skipped };
}

async function discoverRoot(root: string, signal?: AbortSignal) {
  const pending = [root];
  const jsonlPaths: string[] = [];
  let skipped = 0;
  let available = false;
  while (pending.length && jsonlPaths.length < MAX_FILES) {
    throwIfAborted(signal);
    const directory = pending.pop()!;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
      available = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') skipped += 1;
      continue;
    }
    for (const entry of entries) {
      if (entry.name.toLowerCase().includes('trash')) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) jsonlPaths.push(candidate);
      if (jsonlPaths.length >= MAX_FILES) break;
    }
  }
  const metadata = await statCandidates(jsonlPaths, signal);
  return {
    candidates: metadata.candidates,
    skipped: skipped + metadata.skipped + (pending.length ? pending.length : 0),
    available,
  };
}

async function discoverCodexSessions(fromEpoch: number | null, signal?: AbortSignal): Promise<DiscoveryResult> {
  const configuredHome = process.env.CODEX_HOME?.trim();
  const codexHome = path.resolve(configuredHome || path.join(os.homedir(), '.codex'));
  if (containsForbiddenPathSegment(codexHome)) {
    return { files: [], skipped: 0, availableRoots: 0, sourceMode: 'FILESYSTEM_FALLBACK' };
  }
  const indexed = await discoverCodexUsageFromThreadIndex(codexHome, fromEpoch, signal);
  if (indexed.status === 'AVAILABLE') {
    return {
      files: indexed.files.sort((left, right) => right.mtimeMs - left.mtimeMs),
      skipped: indexed.skipped,
      availableRoots: 1,
      sourceMode: 'CODEX_DATABASE',
    };
  }
  const roots = [path.join(codexHome, 'sessions'), path.join(codexHome, 'archived_sessions')];
  const discovered = await Promise.all(roots.map((root) => discoverRoot(root, signal)));
  const newestBySession = new Map<string, CandidateFile>();
  for (const candidate of discovered.flatMap((result) => result.candidates)) {
    const existing = newestBySession.get(candidate.sessionId);
    if (!existing || candidate.mtimeMs > existing.mtimeMs) newestBySession.set(candidate.sessionId, candidate);
  }
  return {
    files: [...newestBySession.values()]
      .filter((file) => fromEpoch === null || file.mtimeMs >= fromEpoch)
      .sort((left, right) => right.mtimeMs - left.mtimeMs),
    skipped: discovered.reduce((sum, result) => addSafe(sum, result.skipped), 0),
    availableRoots: discovered.filter((result) => result.available).length,
    sourceMode: 'FILESYSTEM_FALLBACK',
  };
}

function modelBreakdowns(models: ReadonlyMap<string, MutableAggregate>): CodexUsageModelBreakdown[] {
  return [...models.entries()]
    .map(([model, aggregate]) => ({
      model,
      ...totalsFromAggregate(aggregate),
      requestCount: aggregate.requestCount,
      sessionCount: aggregate.sessions.size,
      longContextRequestCount: aggregate.longContextRequestCount,
    }))
    .sort((left, right) => right.totalTokens - left.totalTokens || left.model.localeCompare(right.model))
    .slice(0, 1_000);
}

function dailyBreakdowns(days: ReadonlyMap<string, MutableAggregate>): CodexUsageDailyBreakdown[] {
  return [...days.entries()]
    .map(([date, aggregate]) => ({
      date,
      ...totalsFromAggregate(aggregate),
      requestCount: aggregate.requestCount,
      sessionCount: aggregate.sessions.size,
    }))
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 10_000);
}

function warningList(
  total: CodexUsageTokenTotals,
  sourceAvailable: boolean,
  filesSkipped: number,
  invalidRecords: number,
  oversizedRecords: number,
  sourceMode: DiscoveryResult['sourceMode'],
  exportRowsTruncated: boolean,
  quotaYield: CodexUsageQuotaYieldAnalysis,
) {
  const warnings = new Set<CodexUsageWarningCode>();
  if (!sourceAvailable) warnings.add('SOURCE_UNAVAILABLE');
  if (filesSkipped) warnings.add('FILES_SKIPPED');
  if (invalidRecords) warnings.add('INVALID_RECORDS');
  if (oversizedRecords) warnings.add('OVERSIZED_RECORDS');
  if (
    total.totalTokens > 0 &&
    (total.apiPricedTokens < total.totalTokens || total.creditPricedTokens < total.totalTokens)
  ) {
    warnings.add('UNPRICED_MODELS');
  }
  if (filesSkipped || invalidRecords || oversizedRecords) warnings.add('PARTIAL_RANGE');
  if (!quotaYield.estimates.length) warnings.add('QUOTA_YIELD_UNAVAILABLE');
  if (
    quotaYield.discardedMixedModelIntervals ||
    quotaYield.discardedMixedTierIntervals ||
    quotaYield.discardedUnknownTierIntervals ||
    quotaYield.discardedUnknownPlanIntervals ||
    quotaYield.discardedUnknownQuotaIntervals ||
    quotaYield.discardedStaleSnapshotIntervals
  ) {
    warnings.add('QUOTA_YIELD_PARTIAL');
  }
  if (sourceMode === 'FILESYSTEM_FALLBACK') warnings.add('DATABASE_INDEX_UNAVAILABLE');
  if (quotaYield.samplesTruncated) warnings.add('QUOTA_SAMPLES_TRUNCATED');
  if (exportRowsTruncated) warnings.add('EXPORT_ROWS_TRUNCATED');
  return [...warnings];
}

function processedCacheKey(
  range: CodexUsageRange,
  fromEpoch: number | null,
  toEpoch: number,
  timeZone: string,
  granularity: CodexUsageGranularity,
) {
  return `v${PROCESSED_ANALYSIS_VERSION}:${range}:${fromEpoch ?? 'ALL'}:${toEpoch}:${timeZone}:${granularity}`;
}

function processStoredEvents(
  options: ScanOptions,
  coverage: ReturnType<CodexUsageCacheDatabase['eventCoverage']>,
  queryToEpoch: number,
): ProcessedSnapshot {
  const total = emptyAggregate();
  const models = new Map<string, MutableAggregate>();
  const days = new Map<string, MutableAggregate>();
  const groupedRows = new Map<string, CodexUsageInternalRow>();
  const quotaYield = new CodexQuotaYieldAccumulator({
    coverage,
    range: options.range,
    timeZone: options.timeZone,
  });
  for (const event of options.cache.events(options.fromEpoch, queryToEpoch)) {
    throwIfAborted(options.signal);
    quotaYield.add(event);
    if (!event.usage.totalTokens) continue;
    const row = rowFromEvent(event, options.timeZone);
    mergeRow(total, row);
    const model = models.get(row.model) ?? emptyAggregate();
    mergeRow(model, row);
    models.set(row.model, model);
    const day = days.get(row.date) ?? emptyAggregate();
    mergeRow(day, row);
    days.set(row.date, day);
    const rowKey = `${row.sessionId}\u0000${row.date}\u0000${row.model}\u0000${row.serviceTier}\u0000${row.quotaKind}`;
    const existing = groupedRows.get(rowKey);
    if (existing) mergeInternalRow(existing, row);
    else groupedRows.set(rowKey, row);
  }
  const allExportRows = [...groupedRows.values()].sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      left.model.localeCompare(right.model) ||
      left.sessionId.localeCompare(right.sessionId),
  );
  return {
    sessionCount: total.sessions.size,
    requestCount: total.requestCount,
    totals: totalsFromAggregate(total),
    models: modelBreakdowns(models),
    days: dailyBreakdowns(days),
    quotaYield: quotaYield.result(),
    exportRows: allExportRows.slice(0, MAX_EXPORT_ROWS),
    exportRowsTruncated: allExportRows.length > MAX_EXPORT_ROWS,
  };
}

export async function scanCodexUsage(options: ScanOptions): Promise<CodexUsageScanResult> {
  const startedAt = Date.now();
  const { range, fromEpoch, toEpoch, signal } = options;
  options.onProgress?.({
    phase: 'DISCOVERING',
    filesDiscovered: 0,
    filesProcessed: 0,
    filesScanned: 0,
    filesCached: 0,
    bytesRead: 0,
    bytesTotal: 0,
    throughputBytesPerSecond: 0,
    estimatedRemainingMs: null,
    elapsedMs: 0,
  });
  const discovery = await discoverCodexSessions(fromEpoch, signal);
  const files = discovery.files;
  let filesProcessed = 0;
  let filesScanned = 0;
  let filesCached = 0;
  let filesSkipped = discovery.skipped;
  let invalidRecords = 0;
  let oversizedRecords = 0;
  let bytesRead = 0;
  const cacheHits = new Set(
    files.filter((file) => options.cache.hasIngestedSource(file)).map((file) => file.sessionId),
  );
  let bytesTotal = files.reduce((sum, file) => (cacheHits.has(file.sessionId) ? sum : addSafe(sum, file.size)), 0);
  const ioStartedAt = Date.now();
  let lastProgressAt = 0;
  const progressSnapshot = (phase: CodexUsageScanProgress['phase']): CodexUsageScanProgress => {
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    const ioElapsedMs = Math.max(0, Date.now() - ioStartedAt);
    const throughputBytesPerSecond = ioElapsedMs > 0 ? bytesRead / (ioElapsedMs / 1_000) : 0;
    const remainingBytes = Math.max(0, bytesTotal - bytesRead);
    return {
      phase,
      filesDiscovered: files.length,
      filesProcessed,
      filesScanned,
      filesCached,
      bytesRead,
      bytesTotal,
      throughputBytesPerSecond,
      estimatedRemainingMs:
        phase === 'SCANNING' && throughputBytesPerSecond > 0
          ? Math.ceil((remainingBytes / throughputBytesPerSecond) * 1_000)
          : null,
      elapsedMs,
    };
  };
  const progress = (force = false, phase: CodexUsageScanProgress['phase'] = 'SCANNING') => {
    const now = Date.now();
    if (!force && now - lastProgressAt < 200) return;
    lastProgressAt = now;
    options.onProgress?.(progressSnapshot(phase));
  };
  progress(true);
  for (const file of files) {
    throwIfAborted(signal);
    const bytesBeforeFile = bytesRead;
    try {
      if (cacheHits.has(file.sessionId)) {
        filesCached += 1;
      } else {
        const result = await readCodexUsageSession(
          file.filePath,
          file.sessionId,
          file.fallbackModel,
          null,
          Number.MAX_SAFE_INTEGER,
          signal,
          (bytes) => {
            bytesRead = addSafe(bytesRead, bytes);
            progress();
          },
        );
        options.cache.replaceIngestedSource(file, result);
        filesScanned += 1;
        invalidRecords = addSafe(invalidRecords, result.invalidRecords);
        oversizedRecords = addSafe(oversizedRecords, result.oversizedRecords);
        bytesTotal = Math.max(bytesRead, bytesTotal - Math.max(0, file.size - result.bytesRead));
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      filesSkipped = addSafe(filesSkipped, 1);
      const consumed = bytesRead - bytesBeforeFile;
      bytesTotal = Math.max(bytesRead, bytesTotal - Math.max(0, file.size - consumed));
    }
    filesProcessed += 1;
    progress(true);
    options.onCheckpoint?.(progressSnapshot('SCANNING'));
  }
  progress(true, 'FINALIZING');
  const allCoverage = options.cache.eventCoverage();
  const storedToEpoch = allCoverage.storedTo ? Date.parse(allCoverage.storedTo) : toEpoch;
  const queryToEpoch = Math.min(toEpoch, storedToEpoch);
  const coverage = options.cache.eventCoverage(fromEpoch, queryToEpoch);
  const cacheKey = processedCacheKey(range, fromEpoch, queryToEpoch, options.timeZone, options.granularity);
  let processed = options.cache.readProcessed(cacheKey, processedSnapshotSchema);
  if (!processed) {
    processed = processStoredEvents(options, coverage, queryToEpoch);
    options.cache.saveProcessed(cacheKey, processed, processedSnapshotSchema);
  }
  const sourceAvailable = discovery.availableRoots > 0 || coverage.sourceEventCount > 0;
  const investigation: CodexUsageInvestigation = {
    investigationId: options.investigationId,
    generatedAt: new Date().toISOString(),
    range,
    timeZone: options.timeZone,
    granularity: options.granularity,
    from: fromEpoch === null ? null : new Date(fromEpoch).toISOString(),
    to: new Date(queryToEpoch).toISOString(),
    sourceLabel: 'plugin SQLite ← Codex indexed rollouts',
    sourceMode: discovery.sourceMode,
    sessionCount: processed.sessionCount,
    requestCount: processed.requestCount,
    filesDiscovered: files.length,
    filesScanned,
    filesCached,
    filesSkipped,
    relevantInvalidRecords: invalidRecords,
    oversizedRecords,
    bytesRead,
    durationMs: Date.now() - startedAt,
    totals: processed.totals,
    models: processed.models,
    days: processed.days,
    quotaYield: processed.quotaYield,
    quotaState: 'UNAVAILABLE',
    quotaMessage: null,
    quota: null,
    pricing: CODEX_USAGE_PRICING_BASIS,
    warnings: warningList(
      processed.totals,
      sourceAvailable,
      filesSkipped,
      invalidRecords,
      oversizedRecords,
      discovery.sourceMode,
      processed.exportRowsTruncated,
      processed.quotaYield,
    ),
  };
  return { investigation, exportRows: processed.exportRows };
}
