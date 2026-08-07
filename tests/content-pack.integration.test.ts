import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryDatabase } from '../src/main/database';
import { fixturePath } from './support/fixtures';

const roots: string[] = [];
const databases: LibraryDatabase[] = [];

function temporaryRoot(prefix: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function openDatabase(root: string) {
  const database = new LibraryDatabase(path.join(root, 'library.sqlite3'), root);
  databases.push(database);
  database.initialize();
  return database;
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    try {
      database.close();
    } catch {
      // A test may close before reopening.
    }
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('external content packs', () => {
  it('imports an explicitly selected package with arbitrary filenames and semantic facet roles', () => {
    const root = temporaryRoot('aiy-content-pack-');
    const database = openDatabase(root);

    expect(database.searchTerms('en')).toEqual([]);
    expect(database.importContentPack(fixturePath('content-pack'))).toBe('test.synthetic-pack');

    expect(database.searchTerms('en').map((term) => term.stableKey)).toEqual(['test.pack.one']);
    expect(database.getFacets('en')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stableKey: 'arbitrary_group_key', systemRole: 'PRIMARY_CLASSIFICATION' }),
        expect.objectContaining({ stableKey: 'arbitrary_kind_key', systemRole: 'SECONDARY_CLASSIFICATION' }),
      ]),
    );
    expect(database.listPackCatalog()).toEqual([
      expect.objectContaining({
        pack: expect.objectContaining({ id: 'test.synthetic-pack' }),
        installation: expect.objectContaining({ state: 'INSTALLED' }),
      }),
    ]);
  });

  it('never reopens or validates an imported package during application startup', () => {
    const root = temporaryRoot('aiy-content-startup-');
    const packageRoot = path.join(root, 'selected-package');
    cpSync(fixturePath('content-pack'), packageRoot, { recursive: true });
    const database = openDatabase(root);
    database.importContentPack(packageRoot);
    database.close();

    writeFileSync(path.join(packageRoot, 'taxonomy.json'), '{ broken external content', 'utf8');
    const reopened = openDatabase(root);

    expect(reopened.searchTerms('en').map((term) => term.stableKey)).toEqual(['test.pack.one']);
    expect(() => reopened.importContentPack(packageRoot)).toThrow();
  });

  it('creates a space-scoped local override when an installed term is revised', () => {
    const root = temporaryRoot('aiy-content-override-');
    const database = openDatabase(root);
    database.importContentPack(fixturePath('content-pack'));
    const original = database.searchTerms('en').find((term) => term.stableKey === 'test.pack.one')!;
    const base = database.db
      .prepare(
        `SELECT link.release_item_id, item.content_hash
        FROM pack_object_links link
        JOIN pack_release_items item ON item.id = link.release_item_id
        WHERE link.local_object_type = 'TERM' AND link.local_object_id = ? AND link.deleted_at IS NULL`,
      )
      .get(original.id) as { release_item_id: string; content_hash: string };

    const withdrawn = database.withdrawTermApproval(original.id, 'en');
    database.saveTermDraft(
      {
        termId: withdrawn.id,
        title: withdrawn.title,
        titleLocale: withdrawn.titleLocale,
        definition: 'Locally revised definition.',
        aliases: withdrawn.aliases,
        localizations: withdrawn.localizations,
        classificationIds: withdrawn.classificationIds,
        primaryDirectoryClassificationId: withdrawn.primaryDirectoryClassificationId,
        expressions: withdrawn.expressions,
      },
      'en',
    );
    const revised = database.approveTerm(original.id, 'en');
    const override = database.db
      .prepare(
        `SELECT base_release_item_id, local_object_type, local_revision_id, scope_type, scope_id, state
        FROM local_overrides WHERE deleted_at IS NULL`,
      )
      .get() as Record<string, string>;

    expect(revised.definition).toBe('Locally revised definition.');
    expect(override).toMatchObject({
      base_release_item_id: base.release_item_id,
      local_object_type: 'TERM',
      local_revision_id: revised.termRevisionId,
      scope_type: 'SPACE',
      scope_id: '',
      state: 'ACTIVE',
    });
    expect(
      database.db.prepare('SELECT content_hash FROM pack_release_items WHERE id = ?').get(base.release_item_id),
    ).toEqual({ content_hash: base.content_hash });
  });

  it('isolates an explicit import failure from the initialized library', () => {
    const root = temporaryRoot('aiy-content-failure-');
    const packageRoot = path.join(root, 'invalid-package');
    cpSync(fixturePath('content-pack'), packageRoot, { recursive: true });
    writeFileSync(path.join(packageRoot, 'manifest.json'), '{ invalid manifest', 'utf8');
    const database = openDatabase(root);
    const libraryName = database.getLibraryName();

    expect(() => database.importContentPack(packageRoot)).toThrow();
    expect(database.getLibraryName()).toBe(libraryName);
    expect(database.db.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  });
});
