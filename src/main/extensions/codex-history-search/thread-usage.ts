import { stat } from 'node:fs/promises';
import { readThreadDescriptor, safeRolloutPath } from '@/main/extensions/codex-history-search/thread-reader';
import type { CodexHistorySourcePaths } from '@/main/extensions/codex-history-search/source-reader';
import { readCodexUsageSession } from '@/main/extensions/codex-usage-investigator/session-reader';
import { estimateCodexUsage, normalizeCodexUsageModel } from '@/main/extensions/codex-usage-investigator/pricing';
import type { CodexHistoryThreadUsage } from '@/shared/contracts/codex-history-search';

/** A bounded cache of summaries only; raw session events are never retained. */
export class CodexHistoryThreadUsageReader {
  private cache = new Map<string, { fingerprint: string; value: CodexHistoryThreadUsage }>();

  clear() {
    this.cache.clear();
  }

  async read(paths: CodexHistorySourcePaths, home: string, threadId: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const descriptor = readThreadDescriptor(paths.stateDatabasePath, threadId);
    const file = await safeRolloutPath(home, descriptor.rolloutPath, signal);
    const fingerprint = async () => {
      const info = await stat(file, { bigint: true });
      return `${file}:${info.size}:${info.mtimeNs}:${info.ctimeNs}:${descriptor.model}:${descriptor.createdAtMs}`;
    };
    const before = await fingerprint();
    signal.throwIfAborted();
    const cached = this.cache.get(threadId);
    if (cached?.fingerprint === before) return cached.value;
    const result = await readCodexUsageSession(file, threadId, 0, descriptor.model, null, Date.now(), null, signal);
    const models = new Map<string, CodexHistoryThreadUsage['models'][number]>();
    for (const event of result.events) {
      // Fork rollouts may contain inherited events from before this task existed.
      if (descriptor.createdAtMs !== null && Date.parse(event.timestamp) < descriptor.createdAtMs) continue;
      if (!event.usage.totalTokens) continue;
      const model = normalizeCodexUsageModel(event.model);
      const row = models.get(model) ?? {
        model,
        totalTokens: 0,
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        apiPricedTokens: 0,
        apiEquivalentUsd: null,
      };
      for (const key of [
        'totalTokens',
        'inputTokens',
        'cachedInputTokens',
        'cacheWriteInputTokens',
        'outputTokens',
        'reasoningOutputTokens',
      ] as const)
        row[key] += event.usage[key];
      const price = estimateCodexUsage(event.model, event.usage, event.serviceTier, event.timestamp);
      row.apiPricedTokens += price.apiPricedTokens;
      if (price.apiEquivalentUsd !== null) row.apiEquivalentUsd = (row.apiEquivalentUsd ?? 0) + price.apiEquivalentUsd;
      models.set(model, row);
    }
    signal.throwIfAborted();
    const after = await fingerprint();
    signal.throwIfAborted();
    const value: CodexHistoryThreadUsage = {
      threadId,
      models: [...models.values()],
      partial:
        descriptor.createdAtMs === null || result.invalidRecords > 0 || result.oversizedRecords > 0 || before !== after,
    };
    if (before === after) {
      this.cache.delete(threadId);
      this.cache.set(threadId, { fingerprint: before, value });
      if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value!);
    }
    return value;
  }
}
