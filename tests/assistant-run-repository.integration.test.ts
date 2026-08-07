import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  AssistantCapabilityReceiptDto,
  CodexAssistResult,
  CreatorAgentAssistInput,
} from '../src/shared/contracts';
import { AssistantRunRepository } from '../src/main/database/assistant-run-repository';
import { initializeDatabaseSchema } from '../src/main/database/schema';
import { LibraryStorage } from '../src/main/database/storage';

const roots: string[] = [];
const stores: LibraryStorage[] = [];

function openRepository() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aibd-assistant-runs-'));
  roots.push(root);
  const storage = new LibraryStorage(path.join(root, 'library.sqlite3'), root);
  stores.push(storage);
  initializeDatabaseSchema(storage.db);
  storage.db
    .prepare(
      `INSERT INTO creation_drafts
    (id, text_content, created_at, updated_at) VALUES (?, '', ?, ?)`,
    )
    .run('draft-1', '2026-01-01', '2026-01-01');
  storage.db
    .prepare(
      `INSERT INTO prompt_series
    (id, title, created_at) VALUES (?, '', ?)`,
    )
    .run('series-1', '2026-01-01');
  return { storage, repository: new AssistantRunRepository(storage) };
}

function input(overrides: Partial<CreatorAgentAssistInput> = {}): CreatorAgentAssistInput {
  return {
    mode: 'directions',
    prompt: 'a portrait with cinematic light',
    locale: 'en',
    directTerms: [],
    recipes: [],
    referenceAssets: [],
    termPromptLocale: 'en',
    canvasPresetKey: 'square',
    canvasWidth: 1024,
    canvasHeight: 1024,
    generationTargets: [],
    scope: { kind: 'DRAFT', id: 'draft-1' },
    contextKey: 'draft-context-v1',
    ...overrides,
  };
}

const receipt: AssistantCapabilityReceiptDto = {
  directTermCount: 0,
  recipeCount: 0,
  referenceCount: 0,
  visionAnalyzed: false,
};

const result: CodexAssistResult = {
  assistantMessage: 'Three controlled directions are ready.',
  optimizedPrompt: '',
  promptEdit: {
    summary: 'Preserve the subject and vary only the lighting.',
    preserved: ['subject'],
    changes: [{ before: 'soft light', after: 'hard rim light', reason: 'Creates separation' }],
    removed: ['mixed lighting'],
    revisedUserInstruction: 'a portrait with hard rim light',
  },
  sharedConstraints: ['same subject', 'same crop'],
  assumptions: [
    {
      label: 'Refinement',
      interpretation: 'Refinement means more controlled lighting.',
      impact: 'Lighting is the only experiment axis.',
    },
  ],
  directions: [
    {
      label: 'Hard rim light',
      prompt: 'a portrait with hard rim light',
      rationale: 'Separates the subject from the background.',
      variableAxis: 'lighting',
      risk: 'May lose shadow detail.',
    },
  ],
};

afterEach(() => {
  for (const storage of stores.splice(0)) {
    try {
      storage.close();
    } catch {
      // The test may already have closed this handle.
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('AssistantRunRepository', () => {
  it('freezes the request and persists a complete successful proposal', () => {
    const { storage, repository } = openRepository();
    const request = input();
    const started = repository.start(request, 'sha256:context-v1', receipt);
    request.prompt = 'edited while the assistant is running';

    expect(started).toMatchObject({
      scope: { kind: 'DRAFT', id: 'draft-1' },
      mode: 'directions',
      status: 'RUNNING',
      contextKey: 'draft-context-v1',
      contextHash: 'sha256:context-v1',
      capabilityReceipt: receipt,
      errorMessage: '',
      dismissedAt: null,
      finishedAt: null,
    });
    expect(
      JSON.parse(
        (
          storage.db.prepare('SELECT request_json FROM assistant_runs WHERE id = ?').get(started.id) as {
            request_json: string;
          }
        ).request_json,
      ),
    ).toMatchObject({
      prompt: 'a portrait with cinematic light',
      contextKey: 'draft-context-v1',
    });

    const succeeded = repository.succeed(started.id, result);
    expect(succeeded).toMatchObject({
      id: started.id,
      status: 'SUCCEEDED',
      proposal: { id: started.id, status: 'READY', result },
      errorMessage: '',
      finishedAt: expect.any(String),
    });
    expect(repository.get(started.id)).toEqual(succeeded);
    expect(repository.list({ kind: 'DRAFT', id: 'draft-1' })).toEqual([succeeded]);
    expect(() => repository.fail(started.id, 'late failure')).toThrow('already succeeded');
  });

  it('persists proposal expiry, adoption and closure independently from run execution', () => {
    const { storage, repository } = openRepository();
    const run = repository.start(input(), 'sha256:lifecycle', receipt);
    repository.succeed(run.id, result);

    expect(() => repository.expireProposal(run.id, 'draft-context-v1')).toThrow('still matches');
    expect(repository.expireProposal(run.id, 'draft-context-v2').proposal?.status).toBe('EXPIRED');
    expect(
      repository.adoptProposal({
        runId: run.id,
        baseContextKey: 'draft-context-v1',
        resultContextKey: 'draft-context-v2',
        authorizedContextKey: 'draft-context-v2',
        beforePrompt: 'a portrait with cinematic light',
        afterPrompt: 'a portrait with hard rim light',
      }).proposal,
    ).toMatchObject({
      status: 'ADOPTED',
      adoptedContextKey: 'draft-context-v2',
    });
    expect(
      repository.adoptProposal({
        runId: run.id,
        baseContextKey: 'draft-context-v2',
        resultContextKey: 'draft-context-v3',
        authorizedContextKey: 'draft-context-v3',
        beforePrompt: 'a portrait with hard rim light',
        afterPrompt: 'a portrait with controlled rim light',
      }).proposal,
    ).toMatchObject({
      status: 'ADOPTED',
      adoptedContextKey: 'draft-context-v3',
    });
    expect(
      storage.db
        .prepare(
          `SELECT COUNT(*) AS count FROM change_events
      WHERE entity_type = 'ASSISTANT_PROPOSAL_APPLICATION' AND operation = 'CREATE'`,
        )
        .get(),
    ).toEqual({ count: 2 });
    expect(repository.closeProposal(run.id).proposal?.status).toBe('CLOSED');
    expect(() =>
      repository.adoptProposal({
        runId: run.id,
        baseContextKey: 'draft-context-v3',
        resultContextKey: 'draft-context-v4',
        authorizedContextKey: 'draft-context-v4',
        beforePrompt: 'before',
        afterPrompt: 'after',
      }),
    ).toThrow('already closed');
  });

  it('persists failure without manufacturing a proposal', () => {
    const { repository } = openRepository();
    const started = repository.start(
      input({
        mode: 'optimize',
        scope: { kind: 'SERIES', id: 'series-1' },
      }),
      'sha256:series-v1',
      receipt,
    );

    const failed = repository.fail(started.id, 'Model response was invalid');
    expect(failed).toMatchObject({
      status: 'FAILED',
      errorMessage: 'Model response was invalid',
      finishedAt: expect.any(String),
    });
    expect(repository.dismiss(failed.id)).toMatchObject({ dismissedAt: expect.any(String) });
    expect(repository.dismiss(failed.id).dismissedAt).toBeTruthy();
    expect(repository.list({ kind: 'DRAFT', id: 'draft-1' })).toEqual([]);
  });

  it('interrupts only running calls during startup reconciliation', () => {
    const { storage, repository } = openRepository();
    const completed = repository.start(input(), 'sha256:complete', receipt);
    repository.succeed(completed.id, result);
    const running = repository.start(input({ contextKey: 'draft-context-v2' }), 'sha256:running', receipt);

    expect(repository.interruptRunningAtStartup()).toBe(1);
    expect(repository.get(running.id)).toMatchObject({
      status: 'INTERRUPTED',
      errorMessage: 'Application closed before assistant response completed',
      finishedAt: expect.any(String),
    });
    expect(repository.get(completed.id)?.status).toBe('SUCCEEDED');
    expect(repository.interruptRunningAtStartup()).toBe(0);
    expect(() => repository.succeed(running.id, result)).toThrow('already interrupted');
    expect(
      storage.db
        .prepare(
          `SELECT COUNT(*) AS count FROM change_events
      WHERE entity_type = 'ASSISTANT_RUN' AND operation = 'INTERRUPT'`,
        )
        .get(),
    ).toEqual({ count: 1 });
  });

  it('rejects unsupported modes and unavailable scopes before inserting a run', () => {
    const { repository } = openRepository();
    expect(() => repository.start(input({ mode: 'chat' }), 'sha256:chat', receipt)).toThrow(
      'Unsupported persisted assistant mode',
    );
    expect(() =>
      repository.start(
        input({
          scope: { kind: 'DRAFT', id: 'missing-draft' },
        }),
        'sha256:missing',
        receipt,
      ),
    ).toThrow('Assistant target is no longer available');
  });
});
