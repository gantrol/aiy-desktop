import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LibraryDatabase } from '../src/main/database';

const roots: string[] = [];

function openEmptyDatabase() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'aibd-term-identity-'));
  roots.push(root);
  const database = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
  database.initialize();
  return database;
}

function insertTerm(
  database: LibraryDatabase,
  input: { termId: string; revisionId: string; stableKey: string; title: string },
) {
  database.db
    .prepare(
      `INSERT INTO terms (id, stable_key, current_revision_id, editorial_state, archived_at)
      VALUES (?, ?, NULL, 'APPROVED', NULL)`,
    )
    .run(input.termId, input.stableKey);
  database.db
    .prepare(
      `INSERT INTO term_revisions
      (id, term_id, revision_no, title, title_locale, definition, created_at)
      VALUES (?, ?, 1, ?, 'en', '', ?)`,
    )
    .run(input.revisionId, input.termId, input.title, '2026-07-30T00:00:00.000Z');
  database.db.prepare('UPDATE terms SET current_revision_id = ? WHERE id = ?').run(input.revisionId, input.termId);
  const contextId = `${input.termId}:context:legacy`;
  const contextRevisionId = `${input.revisionId}:context:legacy`;
  database.db
    .prepare(
      `INSERT INTO term_context_profiles(id, term_id, stable_key, created_at)
      VALUES (?, ?, 'general.default', ?)`,
    )
    .run(contextId, input.termId, '2026-07-30T00:00:00.000Z');
  database.db
    .prepare(
      `INSERT INTO term_context_profile_revisions
      (id, context_profile_id, term_revision_id, definition, exclusion_boundary, created_at)
      VALUES (?, ?, ?, '', '', ?)`,
    )
    .run(contextRevisionId, contextId, input.revisionId, '2026-07-30T00:00:00.000Z');
  return contextRevisionId;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('TermListItem revision identity', () => {
  it('returns persisted term and model-expression row IDs without synthesizing fallbacks', () => {
    const database = openEmptyDatabase();
    const expressionContextRevisionId = insertTerm(database, {
      termId: 'term-with-expression',
      revisionId: 'term-revision-real',
      stableKey: 'identity.with-expression',
      title: 'With expression',
    });
    insertTerm(database, {
      termId: 'term-without-expression',
      revisionId: 'term-revision-without-expression',
      stableKey: 'identity.without-expression',
      title: 'Without expression',
    });

    const insertExpression = database.db.prepare(
      `INSERT INTO term_expressions
      (id, term_revision_id, context_profile_revision_id, model_key, locale, positive_expression, negative_expression)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    insertExpression.run(
      'model-expression-real',
      'term-revision-real',
      expressionContextRevisionId,
      'gpt-image-2',
      'en',
      'selected expression',
      'selected negative',
    );
    insertExpression.run(
      'model-expression-zh',
      'term-revision-real',
      expressionContextRevisionId,
      'gpt-image-2',
      'zh',
      '中文表达',
      '',
    );
    insertExpression.run(
      'model-expression-other-model',
      'term-revision-real',
      expressionContextRevisionId,
      'other-model',
      'en',
      'other model expression',
      '',
    );

    const terms = database.searchTerms('en');
    expect(terms.find((term) => term.id === 'term-with-expression')).toMatchObject({
      termRevisionId: 'term-revision-real',
      modelExpressions: [
        {
          id: 'model-expression-real',
          modelKey: 'gpt-image-2',
          locale: 'en',
          positive: 'selected expression',
          negative: 'selected negative',
        },
        {
          id: 'model-expression-zh',
          modelKey: 'gpt-image-2',
          locale: 'zh',
          positive: '中文表达',
          negative: '',
        },
        {
          id: 'model-expression-other-model',
          modelKey: 'other-model',
          locale: 'en',
          positive: 'other model expression',
          negative: '',
        },
      ],
    });
    expect(terms.find((term) => term.id === 'term-without-expression')).toMatchObject({
      termRevisionId: 'term-revision-without-expression',
      modelExpressions: [],
    });

    database.close();
  });
});
