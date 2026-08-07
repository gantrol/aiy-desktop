import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryDatabase } from '../src/main/database';
import type { GenerationInput } from '../src/shared/contracts';

const roots: string[] = [];
const databases: LibraryDatabase[] = [];

function openDatabase(root = mkdtempSync(path.join(os.tmpdir(), 'aiy-durable-generation-'))) {
  if (!roots.includes(root)) roots.push(root);
  const database = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
  database.initialize();
  databases.push(database);
  return { database, root };
}

function closeDatabase(database: LibraryDatabase) {
  const index = databases.indexOf(database);
  if (index >= 0) databases.splice(index, 1);
  database.close();
}

function generationInput(): GenerationInput {
  return {
    seriesId: null,
    title: '耐久任务',
    manualPrompt: '一张耐久生成测试图',
    prompt: 'a durable generation test image',
    changeSummary: '',
    referenceAssetIds: [],
    termPromptLocale: 'en',
    termIds: [],
    wordPaletteReferences: [],
    modelKey: 'gpt-image-2',
    canvasPresetKey: 'square',
    width: 1024,
    height: 1024,
    quality: 'low',
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    try {
      database.close();
    } catch {
      // The individual test may already have closed this handle.
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('durable generation jobs', () => {
  it('persists provider reconciliation state and retries an interrupted run with lineage', () => {
    const opened = openDatabase();
    const prepared = opened.database.prepareGeneration(generationInput());
    opened.database.markGenerationPhase(prepared.runId, 'SUBMITTING', 0.1);
    opened.database.recordGenerationProviderAccepted(prepared.runId, {
      providerKey: 'openai',
      providerRequestId: 'response_123',
      checkpoint: { responseId: 'response_123', pollAfterMs: 1500 },
    });
    opened.database.markGenerationPhase(prepared.runId, 'WAITING_PROVIDER', 0.25, 'queued remotely');
    opened.database.saveGenerationCheckpoint(prepared.runId, { responseId: 'response_123', pollAfterMs: 3000 }, 0.3);
    closeDatabase(opened.database);

    const reopened = openDatabase(opened.root).database;
    expect(reopened.getGenerationJob(prepared.runId)).toMatchObject({
      status: 'INTERRUPTED',
      phase: 'INTERRUPTED',
      progress: 0.3,
      providerKey: 'openai',
      providerRequestId: 'response_123',
      checkpoint: { responseId: 'response_123', pollAfterMs: 3000 },
      errorCode: 'APPLICATION_CLOSED',
      errorMessage: null,
    });
    expect(
      reopened.db
        .prepare(
          `SELECT status, error_code errorCode, error_message errorMessage
      FROM generation_runs WHERE id = ?`,
        )
        .get(prepared.runId),
    ).toEqual({
      status: 'INTERRUPTED',
      errorCode: 'APPLICATION_CLOSED',
      errorMessage: null,
    });
    expect(
      reopened.db
        .prepare(
          `SELECT job.kind, job.desired_state desiredState,
        job.priority, job.not_before notBefore, job.revision,
        attempt.recovery_mode recoveryMode, attempt.retryable,
        attempt.worker_id workerId, attempt.lease_expires_at leaseExpiresAt
      FROM background_jobs job
      JOIN generation_job_links link ON link.job_id = job.id
      JOIN background_job_attempts attempt ON attempt.job_id = job.id
      WHERE link.generation_run_id = ?`,
        )
        .get(prepared.runId),
    ).toMatchObject({
      kind: 'GENERATION',
      desiredState: 'RUN',
      priority: 0,
      notBefore: null,
      revision: expect.any(Number),
      recoveryMode: 'RECONCILE',
      retryable: 1,
      workerId: null,
      leaseExpiresAt: null,
    });
    expect(reopened.listRecoverableGenerationRuns()).toEqual([
      expect.objectContaining({
        runId: prepared.runId,
        recoveryMode: 'RECONCILE',
        providerRequestId: 'response_123',
      }),
    ]);
    expect(reopened.listGenerationRunIdsForTempCleanup()).not.toContain(prepared.runId);

    const retry = reopened.prepareGenerationRetry(prepared.runId);
    const sourceJob = reopened.getGenerationJob(prepared.runId)!;
    const retryJob = reopened.getGenerationJob(retry.runId)!;
    expect(retryJob).toMatchObject({
      status: 'QUEUED',
      rootJobId: sourceJob.rootJobId,
      retryOfJobId: sourceJob.jobId,
    });
    expect(reopened.listRecoverableGenerationRuns()).toEqual([]);
  });

  it('commits the primary output once when completion is delivered more than once', () => {
    const { database, root } = openDatabase();
    const prepared = database.prepareGeneration(generationInput());
    const outputPath = path.join(root, 'result.png');
    writeFileSync(
      outputPath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    );

    const first = database.finishGeneration(prepared.runId, outputPath);
    const second = database.finishGeneration(prepared.runId, outputPath);

    expect(second.id).toBe(first.id);
    expect(database.getGenerationJob(prepared.runId)).toMatchObject({
      status: 'SUCCEEDED',
      phase: 'SUCCEEDED',
      progress: 1,
    });
    expect(
      database.db
        .prepare(
          `SELECT COUNT(*) AS count FROM generation_outputs output
      JOIN generation_job_links link ON link.job_id = output.job_id
      WHERE link.generation_run_id = ? AND output.output_slot = 'primary'`,
        )
        .get(prepared.runId),
    ).toEqual({ count: 1 });
    expect(
      database.db
        .prepare(
          `SELECT COUNT(*) AS count FROM image_assets
      WHERE kind = 'GENERATED' AND origin_type = 'GENERATION'`,
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      database.db
        .prepare(
          `SELECT COUNT(*) AS count FROM background_job_events event
      JOIN generation_job_links link ON link.job_id = event.job_id
      WHERE link.generation_run_id = ? AND event.event_type = 'SUCCEEDED'`,
        )
        .get(prepared.runId),
    ).toEqual({ count: 1 });
    expect(() =>
      database.db
        .prepare(
          `UPDATE background_job_events SET event_type = 'CHANGED'
      WHERE job_id = (SELECT job_id FROM generation_job_links WHERE generation_run_id = ?)`,
        )
        .run(prepared.runId),
    ).toThrow('Background job events are immutable');
    expect(() =>
      database.db
        .prepare(
          `DELETE FROM background_job_events
      WHERE job_id = (SELECT job_id FROM generation_job_links WHERE generation_run_id = ?)`,
        )
        .run(prepared.runId),
    ).toThrow('Background job events are immutable');
  });

  it('marks an interrupted local task as retryable when no provider request was accepted', () => {
    const { database } = openDatabase();
    const prepared = database.prepareGeneration(generationInput());
    database.markGenerationPhase(prepared.runId, 'GENERATING');
    database.markRun(prepared.runId, 'INTERRUPTED', undefined, 'APPLICATION_CLOSED');

    expect(database.listRecoverableGenerationRuns()).toEqual([
      expect.objectContaining({
        runId: prepared.runId,
        errorCode: 'APPLICATION_CLOSED',
        recoveryMode: 'RETRY',
        providerRequestId: null,
      }),
    ]);

    expect(database.markGenerationPhase(prepared.runId, 'RECOVERING')).toMatchObject({
      status: 'RUNNING',
      phase: 'RECOVERING',
      errorCode: null,
      finishedAt: null,
    });
    expect(
      database.db
        .prepare(
          `SELECT status, finished_at finishedAt
      FROM generation_runs WHERE id = ?`,
        )
        .get(prepared.runId),
    ).toEqual({
      status: 'RUNNING',
      finishedAt: null,
    });
  });

  it('settles a persisted cancellation intent instead of offering it for recovery after restart', () => {
    const opened = openDatabase();
    const prepared = opened.database.prepareGeneration(generationInput());
    opened.database.markGenerationPhase(prepared.runId, 'CANCELLING');
    closeDatabase(opened.database);

    const reopened = openDatabase(opened.root).database;
    expect(reopened.getGenerationJob(prepared.runId)).toMatchObject({
      status: 'CANCELLED',
      phase: 'CANCELLED',
      desiredState: 'CANCEL',
      errorCode: 'USER_CANCELLED',
    });
    expect(reopened.listRecoverableGenerationRuns()).toEqual([]);
    expect(
      reopened.db.prepare(`SELECT status, error_code errorCode FROM generation_runs WHERE id = ?`).get(prepared.runId),
    ).toEqual({ status: 'CANCELLED', errorCode: 'USER_CANCELLED' });
  });
});
