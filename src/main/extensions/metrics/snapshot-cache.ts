import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { z } from 'zod';
import {
  extensionMetricCoverageSchema,
  extensionMetricFactSchema,
  type ExtensionMetricCoverage,
  type ExtensionMetricFact,
  type ExtensionMetricQuery,
} from '@/shared/extension-metrics';
import { metricDigest, metricPage } from '@/main/extensions/metrics/pagination';
import type { MetricProviderPage } from '@/main/extensions/metrics/registry';

const storedFact = z.object({ payload: z.string() }).strict();
const storedRefresh = z.object({ start: z.number().safe(), end: z.number().safe(), coverage: z.string() }).strict();
const metaSchema = z.object({ instance: z.string().uuid() }).strict();
const revisionSchema = z.object({ revision: z.number().int().nonnegative().safe() }).strict();
const SCHEMA = `
CREATE TABLE IF NOT EXISTS metric_cache_meta (instance TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS metric_refreshes (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('APPEND', 'REPLACE_RANGE')),
  captured_at TEXT NOT NULL,
  coverage_json TEXT NOT NULL,
  original_json TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS metric_observations (
  refresh_sequence INTEGER NOT NULL REFERENCES metric_refreshes(sequence),
  fact_id TEXT NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (refresh_sequence, fact_id)
) STRICT;
CREATE INDEX IF NOT EXISTS metric_refresh_scope ON metric_refreshes(source_key, sequence);
CREATE INDEX IF NOT EXISTS metric_observation_period ON metric_observations(start_ms, end_ms, fact_id);
CREATE TRIGGER IF NOT EXISTS metric_refresh_no_update BEFORE UPDATE ON metric_refreshes BEGIN SELECT RAISE(ABORT, 'Metric observations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS metric_refresh_no_delete BEFORE DELETE ON metric_refreshes BEGIN SELECT RAISE(ABORT, 'Metric observations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS metric_observation_no_update BEFORE UPDATE ON metric_observations BEGIN SELECT RAISE(ABORT, 'Metric observations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS metric_observation_no_delete BEFORE DELETE ON metric_observations BEGIN SELECT RAISE(ABORT, 'Metric observations are immutable'); END;
`;

export interface MetricCacheSnapshot {
  sourceKey: string;
  startAt: string;
  endAt: string;
  capturedAt: string;
  mode: 'APPEND' | 'REPLACE_RANGE';
  coverage: ExtensionMetricCoverage;
  facts: readonly ExtensionMetricFact[];
  /** Provider-owned response evidence. Never pass credentials or content bodies here. */
  original: unknown;
}

/** Provider private storage. Refresh appends observations; public metric APIs expose reads only. */
export class MetricSnapshotCache {
  constructor(private readonly filePath: string) {}

  async save(snapshot: MetricCacheSnapshot) {
    const coverage = extensionMetricCoverageSchema.parse(snapshot.coverage);
    // An interrupted/partial fetch cannot erase previously observed records.
    if (snapshot.mode === 'REPLACE_RANGE' && coverage.state !== 'COMPLETE') {
      throw new Error('EXTENSION_METRICS_INCOMPLETE_REPLACEMENT');
    }
    if (snapshot.facts.length > 20_000) throw new Error('EXTENSION_METRICS_RESULT_TOO_LARGE');
    const facts = snapshot.facts.map((fact) => extensionMetricFactSchema.parse(fact));
    const ids = new Set(facts.map((fact) => fact.id));
    if (ids.size !== facts.length) throw new Error('EXTENSION_METRICS_DUPLICATE_RECORD');
    const original = JSON.stringify(snapshot.original);
    if (!original || Buffer.byteLength(original) > 32 * 1024 * 1024)
      throw new Error('EXTENSION_METRICS_RESULT_TOO_LARGE');
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const database = new Database(this.filePath);
    try {
      database.pragma('foreign_keys = ON');
      database.exec(SCHEMA);
      database.transaction(() => {
        if (!database.prepare('SELECT instance FROM metric_cache_meta LIMIT 1').get()) {
          database.prepare('INSERT INTO metric_cache_meta(instance) VALUES (?)').run(randomUUID());
        }
        const refresh = database
          .prepare(
            `INSERT INTO metric_refreshes(source_key, start_ms, end_ms, mode, captured_at, coverage_json, original_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            snapshot.sourceKey,
            Date.parse(snapshot.startAt),
            Date.parse(snapshot.endAt),
            snapshot.mode,
            snapshot.capturedAt,
            JSON.stringify(coverage),
            original,
          );
        const insert = database.prepare(
          `INSERT INTO metric_observations(refresh_sequence, fact_id, start_ms, end_ms, kind, payload_json) VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const fact of facts) {
          insert.run(
            refresh.lastInsertRowid,
            fact.id,
            Date.parse(fact.period.startAt),
            Date.parse(fact.period.endAt),
            fact.kind,
            JSON.stringify(fact),
          );
        }
      })();
    } finally {
      database.close();
    }
  }

  async query(input: ExtensionMetricQuery, sourceKey: string): Promise<MetricProviderPage> {
    try {
      await access(this.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return metricPage(input, metricDigest([sourceKey, 'NOT_RECORDED']), sourceKey, [], {
        state: 'EMPTY',
        notes: ['METRIC_CACHE_EMPTY'],
      });
    }
    const database = new Database(this.filePath, { readonly: true, fileMustExist: true });
    try {
      return database.transaction(() => {
        const { instance } = metaSchema.parse(database.prepare('SELECT instance FROM metric_cache_meta LIMIT 1').get());
        const { revision } = revisionSchema.parse(
          database
            .prepare('SELECT COALESCE(MAX(sequence), 0) AS revision FROM metric_refreshes WHERE source_key = ?')
            .get(sourceKey),
        );
        const snapshot = metricDigest([sourceKey, instance, revision]);
        const start = Date.parse(input.startAt);
        const end = Date.parse(input.endAt);
        const refreshes = database
          .prepare(
            `SELECT start_ms AS start, end_ms AS end, coverage_json AS coverage FROM metric_refreshes WHERE source_key = ? AND start_ms < ? AND end_ms > ? ORDER BY start_ms, end_ms`,
          )
          .all(sourceKey, end, start)
          .map((row) => storedRefresh.parse(row));
        let coveredUntil = start;
        const notes = new Set<string>();
        for (const refresh of refreshes) {
          const coverage = extensionMetricCoverageSchema.parse(JSON.parse(refresh.coverage));
          for (const note of coverage.notes) notes.add(note);
          if (coverage.state === 'COMPLETE' && refresh.start <= coveredUntil)
            coveredUntil = Math.max(coveredUntil, refresh.end);
        }
        const coverage: ExtensionMetricCoverage = {
          state: coveredUntil >= end ? 'COMPLETE' : refreshes.length ? 'PARTIAL' : 'EMPTY',
          notes: [...notes].slice(0, 29),
        };
        if (coveredUntil < end) coverage.notes.push('METRIC_CACHE_INCOMPLETE');
        const statement = database.prepare(
          `
          SELECT observation.payload_json AS payload
          FROM metric_observations observation
          JOIN metric_refreshes refresh ON refresh.sequence = observation.refresh_sequence
          WHERE refresh.source_key = ? AND observation.start_ms < ?
            AND (observation.end_ms > ? OR (observation.start_ms = observation.end_ms AND observation.start_ms >= ?))
            AND NOT EXISTS (
              SELECT 1 FROM metric_observations newer_observation
              JOIN metric_refreshes newer_refresh ON newer_refresh.sequence = newer_observation.refresh_sequence
              WHERE newer_refresh.source_key = refresh.source_key AND newer_refresh.sequence > refresh.sequence
                AND newer_observation.fact_id = observation.fact_id
            )
            AND (refresh.mode = 'APPEND' OR NOT EXISTS (
              SELECT 1 FROM metric_refreshes replacement
              WHERE replacement.source_key = refresh.source_key AND replacement.mode = 'REPLACE_RANGE'
                AND replacement.sequence > refresh.sequence
                AND replacement.start_ms <= observation.start_ms AND replacement.end_ms >= observation.end_ms
            ))
          ORDER BY observation.start_ms, observation.kind, observation.fact_id
        `,
        );
        function* facts() {
          // Open the SQLite iterator only after metricPage has accepted the cursor.
          // Otherwise a rejected cursor leaves an unstarted generator holding a live statement.
          for (const row of statement.iterate(sourceKey, end, start, start)) {
            yield extensionMetricFactSchema.parse(JSON.parse(storedFact.parse(row).payload));
          }
        }
        return metricPage(input, snapshot, sourceKey, facts(), coverage);
      })();
    } finally {
      database.close();
    }
  }
}
