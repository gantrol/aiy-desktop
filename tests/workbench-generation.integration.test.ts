import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryDatabase } from '../src/main/database';
import type { GenerationInput } from '../src/shared/contracts';

const roots: string[] = [];

function openEmptyDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aibd-generation-test-'));
  roots.push(root);
  const database = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
  database.initialize();
  return database;
}

function generationInput(title: string): GenerationInput {
  return {
    seriesId: null,
    title: title,
    manualPrompt: `${title} prompt`,
    prompt: `${title} prompt`,
    changeSummary: '',
    referenceAssetIds: [],
    termPromptLocale: 'en',
    termIds: [],
    wordPaletteReferences: [],
    modelKey: 'gpt-image-2',
    canvasPresetKey: 'portrait_2_3',
    width: 1024,
    height: 1536,
    quality: 'low',
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('workbench generation records', () => {
  it('retries into the same prompt version with a new stable run', () => {
    const database = openEmptyDatabase();
    const first = database.prepareGeneration(generationInput('失败样本'));
    database.markRun(first.runId, 'FAILED', 'Provider unavailable');

    const retry = database.prepareGenerationRetry(first.runId);
    expect(retry).toMatchObject({ seriesId: first.seriesId, versionId: first.versionId });
    expect(retry.runId).not.toBe(first.runId);
    expect(retry.input).toMatchObject({ prompt: '失败样本 prompt', width: 1024, height: 1536, quality: 'low' });
    expect(database.getWorkbench().series[0].versions[0].runs.map((run) => run.status)).toEqual(['QUEUED', 'FAILED']);
    expect(
      database.db
        .prepare(
          `SELECT operation FROM change_events
      WHERE entity_type = 'GENERATION_RUN' AND entity_id = ?`,
        )
        .get(retry.runId),
    ).toEqual({ operation: 'RETRY' });
    database.close();
  });

  it('orders result groups by the newest created image, not the series creation time', () => {
    const database = openEmptyDatabase();
    const olderSeries = database.prepareGeneration(generationInput('旧成果，新图片'));
    const newerSeries = database.prepareGeneration(generationInput('新成果，旧图片'));
    database.db
      .prepare('UPDATE prompt_series SET created_at = ? WHERE id = ?')
      .run('2026-01-01T00:00:00.000Z', olderSeries.seriesId);
    database.db
      .prepare('UPDATE prompt_series SET created_at = ? WHERE id = ?')
      .run('2026-02-01T00:00:00.000Z', newerSeries.seriesId);
    database.db
      .prepare(
        `INSERT INTO image_assets
      (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
      VALUES (?, 'GENERATED', 'GENERATION', ?, ?, 1024, 1536, 'image/png', 1, ?, NULL)`,
      )
      .run('asset-newest', 'hash-newest', 'objects/newest.png', '2026-04-01T00:00:00.000Z');
    database.db
      .prepare(
        `INSERT INTO image_assets
      (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
      VALUES (?, 'GENERATED', 'GENERATION', ?, ?, 1024, 1536, 'image/png', 1, ?, NULL)`,
      )
      .run('asset-older', 'hash-older', 'objects/older.png', '2026-03-01T00:00:00.000Z');
    database.db
      .prepare(`UPDATE generation_runs SET status = 'SUCCEEDED', result_asset_id = ? WHERE id = ?`)
      .run('asset-newest', olderSeries.runId);
    database.db
      .prepare(`UPDATE generation_runs SET status = 'SUCCEEDED', result_asset_id = ? WHERE id = ?`)
      .run('asset-older', newerSeries.runId);

    const series = database.getWorkbench().series;
    expect(series.map((item) => item.id)).toEqual([olderSeries.seriesId, newerSeries.seriesId]);
    expect(series[0].cover?.createdAt).toBe('2026-04-01T00:00:00.000Z');
    database.close();
  });
});
