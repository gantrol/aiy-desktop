import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import { agentGenerationDraftSchema, type AgentGenerationDraft } from '@/shared/contracts/agent-cli';

export type AgentCommandKind = 'ASSET_IMPORT' | 'DRAFT_PREPARE' | 'GENERATION_START' | 'JOB_CANCEL';

export interface StoredAgentCommandResult {
  command: AgentCommandKind;
  inputHash: string;
  result: unknown;
  createdAt: string;
}

export interface StoredAgentGenerationJob {
  id: string;
  draft: AgentGenerationDraft;
  runIds: string[];
  createdAt: string;
  startedAt: string | null;
}

function parseJson(value: unknown, message: string): unknown {
  if (typeof value !== 'string') throw new Error(message);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(message);
  }
}

export class AgentCommandRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  getCommand(requestId: string): StoredAgentCommandResult | null {
    const row = this.db.prepare('SELECT * FROM agent_command_requests WHERE id = ?').get(requestId) as
      JsonMap | undefined;
    if (!row) return null;
    return {
      command: text(row.command) as AgentCommandKind,
      inputHash: text(row.input_hash),
      result: parseJson(row.result_json, 'Stored agent command result is invalid'),
      createdAt: text(row.created_at),
    };
  }

  recordCommand(requestId: string, command: AgentCommandKind, inputHash: string, result: unknown) {
    this.db
      .prepare(
        `INSERT INTO agent_command_requests (id, command, input_hash, result_json, created_at)
        VALUES (?, ?, ?, ?, ?)`,
      )
      .run(requestId, command, inputHash, JSON.stringify(result), now());
  }

  createDraftForCommand(
    requestId: string,
    inputHash: string,
    id: string,
    draft: AgentGenerationDraft,
    createdAt: string,
    result: unknown,
  ) {
    return this.db
      .transaction(() => {
        const job = this.createDraft(id, draft, createdAt);
        this.recordCommand(requestId, 'DRAFT_PREPARE', inputHash, result);
        return job;
      })
      .immediate();
  }

  createDraft(id: string, draft: AgentGenerationDraft, createdAt = now()): StoredAgentGenerationJob {
    this.db
      .prepare('INSERT INTO agent_generation_jobs (id, draft_json, created_at, started_at) VALUES (?, ?, ?, NULL)')
      .run(id, JSON.stringify(draft), createdAt);
    return { id, draft, runIds: [], createdAt, startedAt: null };
  }

  getJob(id: string): StoredAgentGenerationJob | null {
    const row = this.db.prepare('SELECT * FROM agent_generation_jobs WHERE id = ?').get(id) as JsonMap | undefined;
    if (!row) return null;
    const draft = agentGenerationDraftSchema.parse(
      parseJson(row.draft_json, 'Stored agent generation draft is invalid'),
    );
    const runIds = (
      this.db
        .prepare('SELECT run_id FROM agent_generation_job_runs WHERE job_id = ? ORDER BY sort_order')
        .all(id) as Array<{ run_id: string }>
    ).map(({ run_id }) => run_id);
    return {
      id,
      draft,
      runIds,
      createdAt: text(row.created_at),
      startedAt: row.started_at ? text(row.started_at) : null,
    };
  }

  private markStartedInCurrentTransaction(id: string, runIds: readonly string[]) {
    if (!runIds.length || new Set(runIds).size !== runIds.length) {
      throw new Error('Agent generation job run list is invalid');
    }
    const job = this.getJob(id);
    if (!job) throw new Error('Agent generation draft not found');
    if (job.startedAt || job.runIds.length) throw new Error('Agent generation job has already started');
    const startedAt = now();
    const insert = this.db.prepare(
      'INSERT INTO agent_generation_job_runs (job_id, run_id, sort_order) VALUES (?, ?, ?)',
    );
    for (const [sortOrder, runId] of runIds.entries()) insert.run(id, runId, sortOrder);
    const updated = this.db
      .prepare('UPDATE agent_generation_jobs SET started_at = ? WHERE id = ? AND started_at IS NULL')
      .run(startedAt, id);
    if (updated.changes !== 1) throw new Error('Agent generation job start state changed concurrently');
  }

  markStarted(id: string, runIds: readonly string[]) {
    this.db.transaction(() => this.markStartedInCurrentTransaction(id, runIds)).immediate();
  }

  markStartedForCommand(requestId: string, inputHash: string, id: string, runIds: readonly string[], result: unknown) {
    this.db
      .transaction(() => {
        this.markStartedInCurrentTransaction(id, runIds);
        this.recordCommand(requestId, 'GENERATION_START', inputHash, result);
      })
      .immediate();
  }
}
