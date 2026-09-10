import { z } from 'zod';
import { CODEX_USAGE_EVENT_PAGE_SIZE } from '@/main/extensions/codex-usage-investigator/cache-records';

/** Consume one SQLite cursor without rerunning joins and ownership calculations for every page. */
export function* sqlitePages<T>(rows: Iterable<unknown>, schema: z.ZodType<T>): Generator<T[]> {
  const pageSchema = z.array(schema).max(CODEX_USAGE_EVENT_PAGE_SIZE);
  let page: unknown[] = [];
  // IteratorClose also releases the SQLite cursor when a consumer cancels or throws.
  for (const row of rows) {
    page.push(row);
    if (page.length < CODEX_USAGE_EVENT_PAGE_SIZE) continue;
    yield pageSchema.parse(page);
    page = [];
  }
  if (page.length) yield pageSchema.parse(page);
}
