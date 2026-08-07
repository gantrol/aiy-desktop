import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeDatabaseSchema } from '../src/main/database/schema';
import { LibraryStorage } from '../src/main/database/storage';
import {
  type CreateStyleExplorationFromRunsInput,
  StyleExplorationRepository,
} from '../src/main/database/style-exploration-repository';
import type { PromptCommonInputDto, StyleExplorationStartInput } from '../src/shared/contracts';

const roots: string[] = [];
const storages: LibraryStorage[] = [];

function openRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aiy-style-exploration-'));
  roots.push(root);
  const storage = new LibraryStorage(path.join(root, 'library.sqlite3'), root);
  storages.push(storage);
  initializeDatabaseSchema(storage.db);
  return { storage, repository: new StyleExplorationRepository(storage) };
}

function addSeries(storage: LibraryStorage, seriesId: string, versionId: string) {
  storage.db
    .prepare(
      `INSERT INTO prompt_series (id, title, created_at, deleted_at)
    VALUES (?, '', '2026-01-01', NULL)`,
    )
    .run(seriesId);
  storage.db
    .prepare(
      `INSERT INTO prompt_versions
    (id, series_id, version_no, user_intent, final_prompt, change_summary, content_hash, created_at)
    VALUES (?, ?, 1, '', '', '', ?, '2026-01-01')`,
    )
    .run(versionId, seriesId, `sha256:${versionId}`);
}

function addRun(storage: LibraryStorage, runId: string, versionId: string, status: string) {
  storage.db
    .prepare(
      `INSERT INTO generation_runs
    (id, prompt_version_id, model_key, width, height, quality, status, created_at)
    VALUES (?, ?, 'gpt-image-2', 1024, 1024, 'low', ?, '2026-01-01')`,
    )
    .run(runId, versionId, status);
}

function addJob(storage: LibraryStorage, jobId: string, retryOfJobId: string | null) {
  storage.db
    .prepare(
      `INSERT INTO background_jobs
    (id, kind, desired_state, status, phase, root_job_id, retry_of_job_id, created_at, updated_at)
    VALUES (?, 'GENERATION', 'RUN', 'QUEUED', 'QUEUED', ?, ?, '2026-01-01', '2026-01-01')`,
    )
    .run(jobId, jobId, retryOfJobId);
}

function addScopeAndAssistant(storage: LibraryStorage, kind: 'DRAFT' | 'SERIES', id: string) {
  if (kind === 'DRAFT') {
    storage.db
      .prepare(
        `INSERT INTO creation_drafts
      (id, text_content, created_at, updated_at, consumed_at, deleted_at)
      VALUES (?, '', '2026-01-01', '2026-01-01', NULL, NULL)`,
      )
      .run(id);
  } else {
    storage.db
      .prepare(
        `INSERT INTO prompt_series (id, title, created_at, deleted_at)
      VALUES (?, '', '2026-01-01', NULL)`,
      )
      .run(id);
  }
  storage.db
    .prepare(
      `INSERT INTO assistant_runs
    (id, scope_kind, scope_id, mode, status, request_json, context_key, context_hash,
      capability_receipt_json, created_at, started_at, updated_at, finished_at)
    VALUES ('assistant-1', ?, ?, 'directions', 'SUCCEEDED', '{}', 'context-1',
      'sha256:context-1', '{}', '2026-01-01', '2026-01-01', '2026-01-01', '2026-01-01')`,
    )
    .run(kind, id);
  storage.db
    .prepare(
      `INSERT INTO assistant_proposals
    (id, assistant_run_id, status, result_json, created_at, updated_at)
    VALUES ('assistant-1', 'assistant-1', 'READY', '{}', '2026-01-01', '2026-01-01')`,
    )
    .run();
}

function createInput(
  overrides: Partial<CreateStyleExplorationFromRunsInput> = {},
): CreateStyleExplorationFromRunsInput {
  return {
    scope: { kind: 'DRAFT', id: 'draft-1' },
    sourceAssistantRunId: 'assistant-1',
    commonConstraints: [' keep the subject ', '', 'same framing'],
    slots: [
      {
        label: 'Direction A',
        rationale: 'Warm editorial light',
        variableAxis: 'lighting',
        risk: 'May lose contrast',
        userInstruction: 'warm rim light',
        seriesId: 'series-a',
        versionId: 'version-a',
        runIds: ['run-a1', 'run-a2'],
      },
      {
        label: 'Direction B',
        rationale: 'Graphic silhouette',
        variableAxis: 'shape language',
        risk: 'Less natural',
        userInstruction: 'strong silhouette',
        seriesId: 'series-b',
        versionId: 'version-b',
        runIds: ['run-b1'],
      },
    ],
    ...overrides,
  };
}

afterEach(() => {
  for (const storage of storages.splice(0)) {
    try {
      storage.close();
    } catch {
      // A test may already have closed the storage handle.
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('StyleExplorationRepository', () => {
  it('creates a batch from prepared runs and preserves stable direction and run order', () => {
    const { storage, repository } = openRepository();
    addScopeAndAssistant(storage, 'DRAFT', 'draft-1');
    addSeries(storage, 'series-a', 'version-a');
    addSeries(storage, 'series-b', 'version-b');
    addRun(storage, 'run-a1', 'version-a', 'QUEUED');
    addRun(storage, 'run-a2', 'version-a', 'RUNNING');
    addRun(storage, 'run-b1', 'version-b', 'QUEUED');

    const batch = repository.createFromPreparedRuns(createInput());

    expect(batch).toMatchObject({
      scope: { kind: 'DRAFT', id: 'draft-1' },
      sourceAssistantRunId: 'assistant-1',
      commonConstraints: ['keep the subject', 'same framing'],
      status: 'RUNNING',
      completedCount: 0,
      failedCount: 0,
      totalCount: 3,
    });
    expect(
      batch.slots.map((slot) => ({
        label: slot.label,
        sortOrder: slot.sortOrder,
        runIds: slot.runIds,
      })),
    ).toEqual([
      { label: 'Direction A', sortOrder: 0, runIds: ['run-a1', 'run-a2'] },
      { label: 'Direction B', sortOrder: 1, runIds: ['run-b1'] },
    ]);
    expect(repository.runIdsForBatch(batch.id)).toEqual(['run-a1', 'run-a2', 'run-b1']);
    expect(repository.runIdsForSlot(batch.slots[1].id)).toEqual(['run-b1']);
    expect(repository.slotIdForRun('run-a2')).toBe(batch.slots[0].id);
    expect(repository.slotIdForRun('run-outside')).toBeNull();
    expect(repository.list({ kind: 'DRAFT', id: 'draft-1' })).toEqual([batch]);
    expect(repository.list({ kind: 'SERIES', id: 'series-a' })).toEqual([]);
    expect(repository.listAll()).toEqual([batch]);
    expect(
      storage.db
        .prepare(
          `SELECT status FROM assistant_proposals
      WHERE assistant_run_id = 'assistant-1'`,
        )
        .get(),
    ).toEqual({ status: 'ADOPTED' });
  });

  it('projects partial success without counting unsuccessful terminal runs as completed', () => {
    const { storage, repository } = openRepository();
    addScopeAndAssistant(storage, 'DRAFT', 'draft-1');
    addSeries(storage, 'series-a', 'version-a');
    addSeries(storage, 'series-b', 'version-b');
    addRun(storage, 'run-a1', 'version-a', 'SUCCEEDED');
    addRun(storage, 'run-a2', 'version-a', 'RUNNING');
    addRun(storage, 'run-b1', 'version-b', 'FAILED');
    addRun(storage, 'run-b2', 'version-b', 'CANCELLED');

    const input = createInput({
      slots: [
        { ...createInput().slots[0], runIds: ['run-a1', 'run-a2'] },
        { ...createInput().slots[1], runIds: ['run-b1', 'run-b2'] },
      ],
    });
    const batch = repository.createFromPreparedRuns(input);

    expect(batch).toMatchObject({
      status: 'PARTIAL',
      completedCount: 1,
      failedCount: 1,
      cancelledCount: 1,
      totalCount: 4,
    });
    expect(batch.slots[0]).toMatchObject({
      status: 'PARTIAL',
      completedCount: 1,
      failedCount: 0,
      totalCount: 2,
    });
    expect(batch.slots[1]).toMatchObject({
      status: 'FAILED',
      completedCount: 0,
      failedCount: 1,
      cancelledCount: 1,
      totalCount: 2,
    });

    storage.db.prepare("UPDATE generation_runs SET status = 'SUCCEEDED'").run();
    expect(repository.get(batch.id)).toMatchObject({
      status: 'SUCCEEDED',
      completedCount: 4,
      failedCount: 0,
      totalCount: 4,
    });
  });

  it('links only a real retry of a run already in the same direction', () => {
    const { storage, repository } = openRepository();
    addScopeAndAssistant(storage, 'DRAFT', 'draft-1');
    addSeries(storage, 'series-a', 'version-a');
    addSeries(storage, 'series-b', 'version-b');
    addRun(storage, 'run-a1', 'version-a', 'FAILED');
    addRun(storage, 'run-b1', 'version-b', 'FAILED');
    addJob(storage, 'job-a1', null);
    addJob(storage, 'job-b1', null);
    storage.db
      .prepare('INSERT INTO generation_job_links (generation_run_id, job_id) VALUES (?, ?)')
      .run('run-a1', 'job-a1');
    storage.db
      .prepare('INSERT INTO generation_job_links (generation_run_id, job_id) VALUES (?, ?)')
      .run('run-b1', 'job-b1');
    const batch = repository.createFromPreparedRuns(
      createInput({
        slots: [
          { ...createInput().slots[0], runIds: ['run-a1'] },
          { ...createInput().slots[1], runIds: ['run-b1'] },
        ],
      }),
    );

    addRun(storage, 'run-a-retry', 'version-a', 'QUEUED');
    addJob(storage, 'job-a-retry', 'job-a1');
    storage.db
      .prepare('INSERT INTO generation_job_links (generation_run_id, job_id) VALUES (?, ?)')
      .run('run-a-retry', 'job-a-retry');

    const retriedSlot = repository.linkRetryRun(batch.slots[0].id, 'run-a-retry');
    expect(retriedSlot).toMatchObject({
      runIds: ['run-a1', 'run-a-retry'],
      status: 'QUEUED',
      completedCount: 0,
      failedCount: 0,
      totalCount: 1,
    });
    expect(repository.retryableRunIdsForSlot(batch.slots[0].id)).toEqual([]);
    expect(repository.retryableRunIdsForSlot(batch.slots[1].id)).toEqual(['run-b1']);

    storage.db.prepare("UPDATE generation_runs SET status = 'FAILED' WHERE id = 'run-a-retry'").run();
    expect(repository.retryableRunIdsForSlot(batch.slots[0].id)).toEqual(['run-a-retry']);
    expect(repository.getSlot(batch.slots[0].id)).toMatchObject({
      status: 'FAILED',
      completedCount: 0,
      failedCount: 1,
      totalCount: 1,
    });

    addRun(storage, 'run-a-outside', 'version-a', 'FAILED');
    addRun(storage, 'run-a-unrelated-retry', 'version-a', 'QUEUED');
    addJob(storage, 'job-a-outside', null);
    addJob(storage, 'job-a-unrelated-retry', 'job-a-outside');
    storage.db
      .prepare('INSERT INTO generation_job_links (generation_run_id, job_id) VALUES (?, ?)')
      .run('run-a-outside', 'job-a-outside');
    storage.db
      .prepare('INSERT INTO generation_job_links (generation_run_id, job_id) VALUES (?, ?)')
      .run('run-a-unrelated-retry', 'job-a-unrelated-retry');
    expect(() => repository.linkRetryRun(batch.slots[0].id, 'run-a-unrelated-retry')).toThrow(
      'not a retry of this exploration direction',
    );

    addRun(storage, 'run-b-retry', 'version-b', 'QUEUED');
    addJob(storage, 'job-b-retry', 'job-b1');
    storage.db
      .prepare('INSERT INTO generation_job_links (generation_run_id, job_id) VALUES (?, ?)')
      .run('run-b-retry', 'job-b-retry');
    expect(() => repository.linkRetryRun(batch.slots[0].id, 'run-b-retry')).toThrow('prompt version');
  });

  it('rejects mismatched assistant scopes and runs prepared from another version', () => {
    const { storage, repository } = openRepository();
    addScopeAndAssistant(storage, 'DRAFT', 'draft-1');
    addSeries(storage, 'series-a', 'version-a');
    addSeries(storage, 'series-b', 'version-b');
    addRun(storage, 'run-a1', 'version-b', 'QUEUED');

    expect(() =>
      repository.createFromPreparedRuns(
        createInput({
          slots: [{ ...createInput().slots[0], runIds: ['run-a1'] }],
        }),
      ),
    ).toThrow('prompt version');

    storage.db.prepare("UPDATE assistant_runs SET scope_id = 'draft-other'").run();
    addRun(storage, 'run-a2', 'version-a', 'QUEUED');
    expect(() =>
      repository.createFromPreparedRuns(
        createInput({
          slots: [{ ...createInput().slots[0], runIds: ['run-a2'] }],
        }),
      ),
    ).toThrow('different creation scope');
  });

  it('treats the frozen proposal and context as the server-side experiment authorization boundary', () => {
    const { storage, repository } = openRepository();
    addScopeAndAssistant(storage, 'DRAFT', 'draft-1');
    const request = {
      termPromptLocale: 'en',
      directTerms: [{ stableId: 'term-1' }],
      recipes: [
        {
          useId: 'palette-1:palette-revision-1',
          stableId: 'palette-1',
          revisionId: 'palette-revision-1',
          parameterValues: { color: 'blue' },
          promptLocale: 'en',
          internalTerms: [],
          parameters: [
            {
              stableId: 'parameter-1',
              revisionId: 'parameter-1',
              selectedOptionId: 'option-blue',
              selectedValue: 'blue',
            },
          ],
          referenceAssets: [],
        },
      ],
      referenceAssets: [{ assetId: 'asset-1' }],
      canvasPresetKey: 'square',
      canvasWidth: 1024,
      canvasHeight: 1024,
      generationTargets: [{ modelKey: 'gpt-image-2', count: 1, quality: 'low' }],
    };
    const result = {
      sharedConstraints: ['same subject'],
      directions: [
        {
          label: 'Direction A',
          prompt: 'warm rim light',
          rationale: 'Warm editorial light',
          variableAxis: 'lighting',
          risk: 'May lose contrast',
        },
      ],
    };
    storage.db
      .prepare(
        `UPDATE assistant_runs SET request_json = ?
      WHERE id = 'assistant-1'`,
      )
      .run(JSON.stringify(request));
    storage.db
      .prepare(
        `UPDATE assistant_proposals SET result_json = ?
      WHERE assistant_run_id = 'assistant-1'`,
      )
      .run(JSON.stringify(result));
    const input: StyleExplorationStartInput = {
      scope: { kind: 'DRAFT', id: 'draft-1' },
      sourceAssistantRunId: 'assistant-1',
      commonConstraints: ['same subject'],
      targets: [{ modelKey: 'gpt-image-2', count: 1, quality: 'low' }],
      slots: [
        {
          ...result.directions[0],
          userInstruction: result.directions[0].prompt,
          input: {
            title: '方向 A',
            manualPrompt: result.directions[0].prompt,
            prompt: 'warm rim light, frozen term and recipe fragments',
            changeSummary: 'Direction experiment',
            referenceAssetIds: ['asset-1'],
            termPromptLocale: 'en',
            termIds: ['term-1'],
            wordPaletteReferences: [
              {
                paletteId: 'palette-1',
                paletteRevisionId: 'palette-revision-1',
                parameterValues: { color: 'blue' },
                promptLocale: 'en',
              },
            ],
            canvasPresetKey: 'square',
            width: 1024,
            height: 1024,
            quality: 'low',
          },
        },
      ],
    };
    const promptSnapshot: PromptCommonInputDto = {
      userInstruction: result.directions[0].prompt,
      directTermPromptLocale: 'en' as const,
      directTerms: [{ termId: 'term-1', termRevisionId: '' }],
      recipes: [
        {
          useId: 'palette-1:palette-revision-1',
          paletteId: 'palette-1',
          paletteRevisionId: 'palette-revision-1',
          name: '测试配方',
          nameLocale: 'zh',
          localizations: [{ locale: 'en', name: 'Test recipe' }],
          promptLocale: 'en' as const,
          parameterValues: { color: 'blue' },
          terms: [],
          parameters: [
            {
              parameterRevisionId: 'parameter-1',
              stableKey: 'color',
              optionId: 'option-blue',
              valueKey: 'blue',
            },
          ],
          contentNodes: [
            {
              id: 'palette-1:text',
              kind: 'TEXT',
              promptFragment: 'frozen recipe fragments',
              negativeFragment: '',
            },
          ],
          references: [],
        },
      ],
      directReferences: [{ assetId: 'asset-1', contentHash: 'sha256:asset-1', role: 'DIRECT_REFERENCE' as const }],
    };

    expect(() => repository.validateStart(input, [promptSnapshot])).not.toThrow();
    expect(() =>
      repository.validateStart(
        {
          ...input,
          slots: [{ ...input.slots[0], userInstruction: 'unapproved prompt' }],
        },
        [promptSnapshot],
      ),
    ).toThrow('unapproved proposal');
    expect(() =>
      repository.validateStart(
        {
          ...input,
          targets: [{ modelKey: 'gpt-image-2', count: 2, quality: 'low' }],
        },
        [promptSnapshot],
      ),
    ).toThrow('targets changed');
    expect(() =>
      repository.validateStart(
        {
          ...input,
          slots: [
            {
              ...input.slots[0],
              input: { ...input.slots[0].input, referenceAssetIds: [] },
            },
          ],
        },
        [promptSnapshot],
      ),
    ).toThrow('context changed');
    expect(() =>
      repository.validateStart(
        {
          ...input,
          slots: [
            {
              ...input.slots[0],
              input: { ...input.slots[0].input, width: 4096, height: 256 },
            },
          ],
        },
        [promptSnapshot],
      ),
    ).toThrow('context changed');
    expect(() =>
      repository.validateStart(input, [
        {
          ...promptSnapshot,
          directTerms: [{ termId: 'term-1', termRevisionId: 'newer-revision' }],
        },
      ]),
    ).toThrow('revisions changed');
    storage.db.prepare("UPDATE assistant_proposals SET status = 'EXPIRED' WHERE id = 'assistant-1'").run();
    expect(() => repository.validateStart(input, [promptSnapshot])).toThrow('no longer available');
  });
});
