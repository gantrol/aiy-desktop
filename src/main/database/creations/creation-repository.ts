import { ulid } from 'ulid';
import type {
  AssistantActivityEventDto,
  AssistantActivityPhase,
  CreationDto,
  CreationElementDto,
  CreatorAgentScope,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import { ContentLifecycleRepository } from '@/main/database/recovery/content-lifecycle-repository';

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

export interface AssistantRunCreationHydration {
  creationId: string;
  creationTitle: string;
  activityEvents: AssistantActivityEventDto[];
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

function creationDto(
  row: JsonMap,
  elements: CreationElementDto[],
  activityEvents: AssistantActivityEventDto[],
): CreationDto {
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
    elements,
    activityEvents,
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
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
    return creationDto(row, this.listElements(id), this.listEvents(id));
  }

  list(limit = 100): CreationDto[] {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = this.db
      .prepare(
        `SELECT * FROM creations WHERE deleted_at IS NULL
      ORDER BY updated_at DESC, id DESC LIMIT ?`,
      )
      .all(safeLimit) as JsonMap[];
    const creationIds = rows.map((row) => text(row.id));
    const elements = this.listElementsForCreations(creationIds);
    const events = this.listEventsForCreations(creationIds);
    return rows.map((row) => {
      const creationId = text(row.id);
      return creationDto(row, elements.get(creationId) ?? [], events.get(creationId) ?? []);
    });
  }

  hydrateAssistantRuns(runIds: readonly string[]): ReadonlyMap<string, AssistantRunCreationHydration> {
    const selectedRunIds = [...new Set(runIds)];
    if (!selectedRunIds.length) return new Map();
    const rows = this.db
      .prepare(
        `WITH linked_creation AS (
        SELECT element.target_id AS assistant_run_id, element.creation_id,
          ROW_NUMBER() OVER (
            PARTITION BY element.target_id ORDER BY element.created_at, element.id
          ) AS link_rank
        FROM creation_elements element
        JOIN json_each(?) selected_run ON selected_run.value = element.target_id
        WHERE element.kind = 'ASSISTANT_RUN' AND element.deleted_at IS NULL
      )
      SELECT linked.assistant_run_id AS linked_assistant_run_id,
        creation.id AS linked_creation_id, creation.title AS linked_creation_title,
        event.id, event.creation_id, event.assistant_run_id, event.sequence, event.phase,
        event.provider_key, event.model_key, event.message, event.payload_json, event.created_at,
        creation.source_scope_kind, creation.source_scope_id, creation.context_key
      FROM linked_creation linked
      JOIN creations creation ON creation.id = linked.creation_id AND creation.deleted_at IS NULL
      LEFT JOIN creation_activity_events event
        ON event.creation_id = creation.id
        AND (event.assistant_run_id IS NULL OR event.assistant_run_id = linked.assistant_run_id)
      WHERE linked.link_rank = 1
      ORDER BY linked.assistant_run_id, event.sequence`,
      )
      .all(JSON.stringify(selectedRunIds)) as JsonMap[];

    const hydration = new Map<string, AssistantRunCreationHydration>();
    for (const row of rows) {
      const runId = text(row.linked_assistant_run_id);
      let entry = hydration.get(runId);
      if (!entry) {
        entry = {
          creationId: text(row.linked_creation_id),
          creationTitle: text(row.linked_creation_title),
          activityEvents: [],
        };
        hydration.set(runId, entry);
      }
      if (row.id !== null && row.id !== undefined) entry.activityEvents.push(eventDto(row));
    }
    return hydration;
  }

  delete(id: string) {
    const creation = this.get(id);
    if (!creation) return;
    return new ContentLifecycleRepository(this.storage, async () => undefined).applyDirect('DELETE', {
      entityType: 'CREATION',
      entityId: id,
    });
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

  private listElementsForCreations(creationIds: readonly string[]) {
    const elements = new Map<string, CreationElementDto[]>();
    if (!creationIds.length) return elements;
    const rows = this.db
      .prepare(
        `SELECT element.* FROM creation_elements element
      JOIN json_each(?) selected_creation ON selected_creation.value = element.creation_id
      WHERE element.deleted_at IS NULL
      ORDER BY element.creation_id, element.sort_order, element.created_at, element.id`,
      )
      .all(JSON.stringify(creationIds)) as JsonMap[];
    for (const row of rows) {
      const creationId = text(row.creation_id);
      const values = elements.get(creationId);
      if (values) values.push(elementDto(row));
      else elements.set(creationId, [elementDto(row)]);
    }
    return elements;
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

  private listEventsForCreations(creationIds: readonly string[]) {
    const events = new Map<string, AssistantActivityEventDto[]>();
    if (!creationIds.length) return events;
    const rows = this.db
      .prepare(
        `SELECT event.*, creation.source_scope_kind,
        creation.source_scope_id, creation.context_key
      FROM creation_activity_events event
      JOIN creations creation ON creation.id = event.creation_id
      JOIN json_each(?) selected_creation ON selected_creation.value = event.creation_id
      ORDER BY event.creation_id, event.sequence`,
      )
      .all(JSON.stringify(creationIds)) as JsonMap[];
    for (const row of rows) {
      const creationId = text(row.creation_id);
      const values = events.get(creationId);
      if (values) values.push(eventDto(row));
      else events.set(creationId, [eventDto(row)]);
    }
    return events;
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
