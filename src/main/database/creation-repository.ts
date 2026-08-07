import { ulid } from 'ulid';
import type {
  AssistantActivityEventDto,
  AssistantActivityPhase,
  CreationDto,
  CreationElementDto,
  CreatorAgentScope,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, now, text } from '@/main/database/values';

interface StartCreationInput {
  scope: CreatorAgentScope;
  contextKey: string;
  briefText: string;
  locale: 'zh' | 'en';
}

interface ActivityDetails {
  providerKey?: string | null;
  modelKey?: string | null;
  message?: string;
  payload?: Record<string, unknown>;
}

function parseObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text(value)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function compactTitle(briefText: string, locale: 'zh' | 'en') {
  const normalized = briefText.replace(/\s+/g, ' ').trim();
  if (!normalized) return locale === 'zh' ? '灵感创作' : 'Idea creation';
  return Array.from(normalized).slice(0, 48).join('');
}

function elementDto(row: JsonMap): CreationElementDto {
  return {
    id: text(row.id),
    creationId: text(row.creation_id),
    kind: text(row.kind) as CreationElementDto['kind'],
    targetId: text(row.target_id),
    payload: parseObject(row.payload_json),
    sortOrder: Number(row.sort_order),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  };
}

function eventDto(row: JsonMap): AssistantActivityEventDto {
  return {
    id: text(row.id),
    creationId: text(row.creation_id),
    assistantRunId: row.assistant_run_id == null ? null : text(row.assistant_run_id),
    scope: {
      kind: text(row.source_scope_kind) as CreatorAgentScope['kind'],
      id: text(row.source_scope_id),
    },
    contextKey: text(row.context_key),
    sequence: Number(row.sequence),
    phase: text(row.phase) as AssistantActivityPhase,
    providerKey: row.provider_key == null ? null : text(row.provider_key),
    modelKey: row.model_key == null ? null : text(row.model_key),
    message: text(row.message),
    payload: parseObject(row.payload_json),
    createdAt: text(row.created_at),
  };
}

export class CreationRepository {
  private readonly db: LibraryStorage['db'];

  constructor(private readonly storage: LibraryStorage) {
    this.db = storage.db;
  }

  startForDirections(input: StartCreationInput): CreationDto {
    return this.db.transaction(() => {
      const reusable = this.db
        .prepare(
          `SELECT id FROM creations
        WHERE source_scope_kind = ? AND source_scope_id = ?
          AND deleted_at IS NULL AND status <> 'ARCHIVED'
        ORDER BY
          CASE status WHEN 'ACTIVE' THEN 0 WHEN 'FORMING' THEN 1 ELSE 2 END,
          created_at, id
        LIMIT 1`,
        )
        .get(input.scope.kind, input.scope.id) as JsonMap | undefined;
      if (reusable) return this.get(text(reusable.id))!;

      const id = ulid();
      const createdAt = now();
      const title = compactTitle(input.briefText, input.locale);
      this.db
        .prepare(
          `INSERT INTO creations
        (id, source_scope_kind, source_scope_id, context_key, title, brief_text, status,
          failure_message, created_at, updated_at, archived_at, deleted_at)
        VALUES (?, ?, ?, ?, ?, ?, 'FORMING', '', ?, ?, NULL, NULL)`,
        )
        .run(id, input.scope.kind, input.scope.id, input.contextKey, title, input.briefText, createdAt, createdAt);
      this.insertElement(
        id,
        'BRIEF',
        id,
        {
          contextKey: input.contextKey,
          text: input.briefText,
        },
        0,
        createdAt,
      );
      this.insertEvent(id, null, 'CREATION_SAVED', {
        message: 'Creation and frozen brief saved',
        payload: { title },
      });
      this.storage.recordChange('CREATION', id, 'CREATE', {
        sourceScope: input.scope,
        contextKey: input.contextKey,
      });
      return this.get(id)!;
    })();
  }

  attachAssistantRun(creationId: string, runId: string) {
    return this.db.transaction(() => {
      const creation = this.get(creationId);
      if (!creation || !['FORMING', 'ACTIVE', 'FAILED'].includes(creation.status))
        throw new Error('Creation is unavailable for assistant work');
      const assistantRun = this.db
        .prepare('SELECT scope_kind, scope_id FROM assistant_runs WHERE id = ?')
        .get(runId) as JsonMap | undefined;
      if (!assistantRun) throw new Error('Assistant run not found');
      if (
        text(assistantRun.scope_kind) !== creation.sourceScope.kind ||
        text(assistantRun.scope_id) !== creation.sourceScope.id
      )
        throw new Error('Assistant run and Creation must use the same source scope');
      if (creation.status === 'FAILED') {
        this.db
          .prepare("UPDATE creations SET status = 'FORMING', failure_message = '', updated_at = ? WHERE id = ?")
          .run(now(), creationId);
      }
      const sortOrder = Math.max(1, ...creation.elements.map((element) => element.sortOrder + 1));
      this.insertElement(creationId, 'ASSISTANT_RUN', runId, {}, sortOrder, now());
      this.storage.recordChange('CREATION_ELEMENT', runId, 'CREATE', {
        creationId,
        kind: 'ASSISTANT_RUN',
      });
      return this.get(creationId)!;
    })();
  }

  recordForAssistantRun(
    runId: string,
    phase: AssistantActivityPhase,
    details: ActivityDetails = {},
  ): AssistantActivityEventDto | null {
    return this.db.transaction(() => {
      const creationId = this.creationIdForAssistantRun(runId);
      if (!creationId) return null;
      return this.insertEvent(creationId, runId, phase, details);
    })();
  }

  completeAssistantRun(runId: string, proposalId: string, directionCount: number) {
    return this.db.transaction(() => {
      const creationId = this.creationIdForAssistantRun(runId);
      if (!creationId) return null;
      const timestamp = now();
      this.insertElement(
        creationId,
        'DIRECTION_SET',
        proposalId,
        {
          assistantRunId: runId,
          directionCount,
        },
        Number(
          this.db
            .prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 FROM creation_elements WHERE creation_id = ?')
            .pluck()
            .get(creationId),
        ),
        timestamp,
      );
      this.db
        .prepare(
          `UPDATE creations SET status = 'ACTIVE', failure_message = '', updated_at = ?
        WHERE id = ? AND status = 'FORMING'`,
        )
        .run(timestamp, creationId);
      const event = this.insertEvent(creationId, runId, 'COMPLETED', {
        message: 'Direction set saved to creation',
        payload: { directionCount },
      });
      this.storage.recordChange('CREATION', creationId, 'ACTIVATE', {
        assistantRunId: runId,
        directionSetId: proposalId,
        directionCount,
      });
      return event;
    })();
  }

  failAssistantRun(runId: string, errorMessage: string, interrupted = false) {
    return this.db.transaction(() => {
      const creationId = this.creationIdForAssistantRun(runId);
      if (!creationId) return null;
      const timestamp = now();
      this.db
        .prepare(
          `UPDATE creations SET status = 'FAILED', failure_message = ?, updated_at = ?
        WHERE id = ? AND status = 'FORMING'`,
        )
        .run(errorMessage, timestamp, creationId);
      const event = this.insertEvent(creationId, runId, interrupted ? 'INTERRUPTED' : 'FAILED', {
        message: errorMessage,
      });
      this.storage.recordChange('CREATION', creationId, interrupted ? 'INTERRUPT' : 'FAIL', {
        assistantRunId: runId,
        errorMessage,
      });
      return event;
    })();
  }

  reconcileInterruptedAssistantRuns() {
    const rows = this.db
      .prepare(
        `SELECT element.target_id AS run_id, run.error_message
      FROM creation_elements element
      JOIN creations creation ON creation.id = element.creation_id
      JOIN assistant_runs run ON run.id = element.target_id
      WHERE element.kind = 'ASSISTANT_RUN' AND element.deleted_at IS NULL
        AND creation.status = 'FORMING' AND run.status = 'INTERRUPTED'`,
      )
      .all() as JsonMap[];
    for (const row of rows) {
      this.failAssistantRun(text(row.run_id), text(row.error_message) || 'Assistant run was interrupted', true);
    }
  }

  getForAssistantRun(runId: string): CreationDto | null {
    const creationId = this.creationIdForAssistantRun(runId);
    return creationId ? this.get(creationId) : null;
  }

  eventsForAssistantRun(runId: string) {
    const creationId = this.creationIdForAssistantRun(runId);
    if (!creationId) return [];
    return this.listEvents(creationId).filter(
      (event) => event.assistantRunId === null || event.assistantRunId === runId,
    );
  }

  get(id: string): CreationDto | null {
    const row = this.db
      .prepare(
        `SELECT * FROM creations
      WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id) as JsonMap | undefined;
    if (!row) return null;
    return {
      id: text(row.id),
      sourceScope: {
        kind: text(row.source_scope_kind) as CreatorAgentScope['kind'],
        id: text(row.source_scope_id),
      },
      title: text(row.title),
      briefText: text(row.brief_text),
      status: text(row.status) as CreationDto['status'],
      failureMessage: text(row.failure_message),
      elements: this.listElements(id),
      activityEvents: this.listEvents(id),
      createdAt: text(row.created_at),
      updatedAt: text(row.updated_at),
    };
  }

  list(limit = 100): CreationDto[] {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = this.db
      .prepare(
        `SELECT id FROM creations WHERE deleted_at IS NULL
      ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(safeLimit) as JsonMap[];
    return rows.flatMap((row) => this.get(text(row.id)) ?? []);
  }

  delete(id: string) {
    return this.db.transaction(() => {
      const creation = this.get(id);
      if (!creation) return;
      const deletedAt = now();
      this.db
        .prepare(
          'UPDATE creation_elements SET deleted_at = ?, updated_at = ? WHERE creation_id = ? AND deleted_at IS NULL',
        )
        .run(deletedAt, deletedAt, id);
      this.db
        .prepare('UPDATE creations SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(deletedAt, deletedAt, id);
      this.storage.recordChange('CREATION', id, 'DELETE', { title: creation.title, deletedAt });
    })();
  }

  private creationIdForAssistantRun(runId: string) {
    const row = this.db
      .prepare(
        `SELECT creation_id FROM creation_elements
      WHERE kind = 'ASSISTANT_RUN' AND target_id = ? AND deleted_at IS NULL
      ORDER BY created_at, id LIMIT 1`,
      )
      .get(runId) as JsonMap | undefined;
    return row ? text(row.creation_id) : null;
  }

  private listElements(creationId: string) {
    const rows = this.db
      .prepare(
        `SELECT * FROM creation_elements
      WHERE creation_id = ? AND deleted_at IS NULL
      ORDER BY sort_order, created_at, id`,
      )
      .all(creationId) as JsonMap[];
    return rows.map(elementDto);
  }

  private listEvents(creationId: string) {
    const rows = this.db
      .prepare(
        `SELECT event.*, creation.source_scope_kind,
        creation.source_scope_id, creation.context_key
      FROM creation_activity_events event
      JOIN creations creation ON creation.id = event.creation_id
      WHERE event.creation_id = ? ORDER BY event.sequence`,
      )
      .all(creationId) as JsonMap[];
    return rows.map(eventDto);
  }

  private insertElement(
    creationId: string,
    kind: CreationElementDto['kind'],
    targetId: string,
    payload: Record<string, unknown>,
    sortOrder: number,
    timestamp: string,
  ) {
    this.db
      .prepare(
        `INSERT INTO creation_elements
      (id, creation_id, kind, target_id, payload_json, sort_order, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(ulid(), creationId, kind, targetId, JSON.stringify(payload), sortOrder, timestamp, timestamp);
  }

  private insertEvent(
    creationId: string,
    assistantRunId: string | null,
    phase: AssistantActivityPhase,
    details: ActivityDetails,
  ): AssistantActivityEventDto {
    const creation = this.db
      .prepare(
        `SELECT source_scope_kind, source_scope_id, context_key
      FROM creations WHERE id = ?`,
      )
      .get(creationId) as JsonMap | undefined;
    if (!creation) throw new Error(`Creation not found: ${creationId}`);
    const sequence = Number(
      this.db
        .prepare(
          `SELECT COALESCE(MAX(sequence), 0) + 1
      FROM creation_activity_events WHERE creation_id = ?`,
        )
        .pluck()
        .get(creationId),
    );
    const id = ulid();
    const createdAt = now();
    this.db
      .prepare(
        `INSERT INTO creation_activity_events
      (id, creation_id, assistant_run_id, sequence, phase, provider_key, model_key,
        message, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        creationId,
        assistantRunId,
        sequence,
        phase,
        details.providerKey ?? null,
        details.modelKey ?? null,
        details.message ?? '',
        JSON.stringify(details.payload ?? {}),
        createdAt,
      );
    const event = eventDto({
      id,
      creation_id: creationId,
      assistant_run_id: assistantRunId,
      sequence,
      phase,
      provider_key: details.providerKey ?? null,
      model_key: details.modelKey ?? null,
      message: details.message ?? '',
      payload_json: JSON.stringify(details.payload ?? {}),
      created_at: createdAt,
      source_scope_kind: creation.source_scope_kind,
      source_scope_id: creation.source_scope_id,
      context_key: creation.context_key,
    });
    this.storage.recordChange('CREATION_ACTIVITY_EVENT', id, phase, event);
    return event;
  }
}
