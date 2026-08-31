import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import { CreationItemRepository } from '@/main/database/creations/creation-item-repository';
import {
  evaluationSuiteContentSchema,
  evaluationSuiteCreateInputSchema,
  evaluationSuiteSchema,
  evaluationSuiteSaveInputSchema,
  type EvaluationSuiteContentInput,
  type EvaluationSuiteCreateInput,
  type EvaluationSuiteDto,
  type EvaluationSuiteSaveInput,
} from '@/shared/contracts/evaluation-suite';

function normalizedContent(content: EvaluationSuiteContentInput) {
  return evaluationSuiteContentSchema.parse(content);
}

function canonicalContentJson(content: EvaluationSuiteContentInput) {
  return JSON.stringify(content);
}

function contentHash(content: EvaluationSuiteContentInput) {
  return createHash('sha256').update(canonicalContentJson(content)).digest('hex');
}

function parseStoredContent(value: unknown) {
  if (typeof value !== 'string') throw new Error('Stored evaluation suite is invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('Stored evaluation suite is invalid');
  }
  return evaluationSuiteContentSchema.parse(parsed);
}

export class EvaluationSuiteRepository {
  private readonly creationItems: CreationItemRepository;

  constructor(private readonly storage: LibraryStorage) {
    this.creationItems = new CreationItemRepository(storage);
  }

  private get db() {
    return this.storage.db;
  }

  list(): EvaluationSuiteDto[] {
    const rows = this.db
      .prepare(
        `SELECT suite.*, revision.id AS revision_id, revision.revision_no,
          revision.content_json, revision.content_hash
        FROM evaluation_suites suite
        JOIN evaluation_suite_revisions revision ON revision.id = suite.current_revision_id
        WHERE suite.status = 'ACTIVE' AND suite.deleted_at IS NULL
        ORDER BY suite.updated_at DESC, suite.id DESC`,
      )
      .all() as JsonMap[];
    return rows.map((row) => this.dto(row));
  }

  get(id: string): EvaluationSuiteDto {
    return this.dto(this.row(id));
  }

  create(input: EvaluationSuiteCreateInput): EvaluationSuiteDto {
    const parsed = evaluationSuiteCreateInputSchema.parse(input);
    return this.db
      .transaction(() => {
        const id = ulid();
        const timestamp = now();
        const content = normalizedContent({
          schemaVersion: 1,
          title: parsed.locale === 'zh' ? '未命名评测集' : 'Untitled evaluation suite',
          defaultRepeatCount: 1,
          cases: [],
          conditions: [],
        });
        const hash = contentHash(content);
        this.db
          .prepare(
            `INSERT INTO evaluation_suites
            (id, album_id, current_revision_id, status, created_at, updated_at, archived_at, deleted_at)
            VALUES (?, ?, NULL, 'ACTIVE', ?, ?, NULL, NULL)`,
          )
          .run(id, parsed.albumId, timestamp, timestamp);
        const revisionId = this.insertRevision(id, 1, content, hash, timestamp);
        this.db.prepare('UPDATE evaluation_suites SET current_revision_id = ? WHERE id = ?').run(revisionId, id);
        const registration = this.creationItems.createWithForm({
          albumId: parsed.albumId,
          form: {
            role: 'EVALUATION_SUITE',
            entity: { kind: 'EVALUATION_SUITE', id },
            anchorKey: null,
          },
        });
        this.storage.recordChange(
          'EVALUATION_SUITE',
          id,
          'CREATE',
          { albumId: parsed.albumId, creationItemId: registration.item.id, revisionId },
          { affectsFileView: false },
        );
        return this.get(id);
      })
      .immediate();
  }

  save(input: EvaluationSuiteSaveInput): EvaluationSuiteDto {
    const parsed = evaluationSuiteSaveInputSchema.parse(input);
    return this.db
      .transaction(() => {
        const existing = this.activeRow(parsed.id);
        const content = normalizedContent(parsed.content);
        const hash = contentHash(content);
        if (text(existing.content_hash) === hash) return this.dto(existing);
        const timestamp = now();
        const revisionId = this.insertRevision(parsed.id, Number(existing.revision_no) + 1, content, hash, timestamp);
        this.db
          .prepare('UPDATE evaluation_suites SET current_revision_id = ?, updated_at = ? WHERE id = ?')
          .run(revisionId, timestamp, parsed.id);
        this.creationItems.touchForEntity({ kind: 'EVALUATION_SUITE', id: parsed.id }, timestamp);
        this.storage.recordChange(
          'EVALUATION_SUITE',
          parsed.id,
          'UPDATE',
          { contentHash: hash, revisionId },
          { affectsFileView: false },
        );
        return this.get(parsed.id);
      })
      .immediate();
  }

  private insertRevision(
    suiteId: string,
    revisionNo: number,
    content: EvaluationSuiteContentInput,
    hash: string,
    createdAt: string,
  ) {
    const id = ulid();
    this.db
      .prepare(
        `INSERT INTO evaluation_suite_revisions
        (id, suite_id, revision_no, content_json, content_hash, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(id, suiteId, revisionNo, canonicalContentJson(content), hash, createdAt);
    this.storage.recordChange(
      'EVALUATION_SUITE_REVISION',
      id,
      'CREATE',
      { suiteId, revisionNo, contentHash: hash },
      { affectsFileView: false },
    );
    return id;
  }

  private row(id: string) {
    const row = this.db
      .prepare(
        `SELECT suite.*, revision.id AS revision_id, revision.revision_no,
          revision.content_json, revision.content_hash
        FROM evaluation_suites suite
        JOIN evaluation_suite_revisions revision ON revision.id = suite.current_revision_id
        WHERE suite.id = ? AND suite.deleted_at IS NULL`,
      )
      .get(id) as JsonMap | undefined;
    if (!row) throw new Error('Evaluation suite not found');
    return row;
  }

  private activeRow(id: string) {
    const row = this.row(id);
    if (text(row.status) !== 'ACTIVE') throw new Error('Archived evaluation suites cannot be changed');
    return row;
  }

  private dto(row: JsonMap) {
    return evaluationSuiteSchema.parse({
      id: row.id,
      albumId: row.album_id == null ? null : row.album_id,
      content: parseStoredContent(row.content_json),
      contentHash: row.content_hash,
      revisionId: row.revision_id,
      revisionNo: Number(row.revision_no),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}
