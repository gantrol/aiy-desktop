import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ExtensionMetricCoverage, ExtensionMetricFact, ExtensionMetricQuery } from '@/shared/extension-metrics';
import type { MetricProviderPage } from '@/main/extensions/metrics/registry';

export function metricDigest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const cursorSchema = z
  .object({
    key: z.string().length(64),
    snapshot: z.string().length(64),
    offset: z.number().int().min(1).max(10_000_000),
  })
  .strict();

export function metricPagePosition(input: ExtensionMetricQuery, snapshot: string, scopeKey: string) {
  const key = metricDigest([
    input.sourceId,
    scopeKey,
    Date.parse(input.startAt),
    Date.parse(input.endAt),
    [...new Set(input.kinds ?? [])].sort(),
  ]);
  if (input.snapshot && input.snapshot !== snapshot) throw new Error('EXTENSION_METRICS_CURSOR_STALE');
  if (!input.cursor) return { key, offset: 0 };
  let cursor: z.infer<typeof cursorSchema>;
  try {
    cursor = cursorSchema.parse(JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')));
  } catch {
    throw new Error('EXTENSION_METRICS_CURSOR_INVALID');
  }
  if (cursor.key !== key) throw new Error('EXTENSION_METRICS_CURSOR_INVALID');
  if (cursor.snapshot !== snapshot) throw new Error('EXTENSION_METRICS_CURSOR_STALE');
  return { key, offset: cursor.offset };
}

/** The iterator must have deterministic source order within one snapshot. It is consumed only through this page. */
export function metricPage(
  input: ExtensionMetricQuery,
  snapshot: string,
  scopeKey: string,
  candidates: Iterable<ExtensionMetricFact>,
  coverage: ExtensionMetricCoverage,
): MetricProviderPage {
  const { key, offset } = metricPagePosition(input, snapshot, scopeKey);
  const limit = input.limit ?? 100;
  const facts: ExtensionMetricFact[] = [];
  let count = 0;
  let hasMore = false;
  for (const fact of candidates) {
    if (input.kinds && !input.kinds.includes(fact.kind)) continue;
    if (count++ < offset) continue;
    if (facts.length === limit) {
      hasMore = true;
      break;
    }
    facts.push(fact);
  }
  const nextCursor = hasMore
    ? Buffer.from(JSON.stringify({ key, snapshot, offset: offset + facts.length })).toString('base64url')
    : null;
  return { snapshot, facts, hasMore, nextCursor, coverage };
}
