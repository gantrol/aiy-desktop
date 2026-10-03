import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { LibraryStorage } from '@/main/database/core/storage';
import type { MeCommand } from '@/shared/contracts/me';

type Assignment = Extract<MeCommand, { kind: 'creation-author-set' }>;

/** A bounded snapshot of exact-name candidates, not an identity equivalence rule. */
export function authorNameMatch(db: Database.Database, name: string) {
  const candidates = db
    .prepare(`SELECT id,revision FROM creation_authors WHERE LOWER(TRIM(name))=LOWER(?) ORDER BY id LIMIT 31`)
    .all(name.trim());
  return {
    count: candidates.length,
    token: candidates.length > 30 ? null : createHash('sha256').update(JSON.stringify(candidates)).digest('hex'),
  };
}

function requestHash(input: Assignment) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        spaceId: input.spaceId,
        target: input.target,
        selection: input.selection,
      }),
    )
    .digest('hex');
}

/** Creation and assignment share a transaction. A matching CREATE proves both committed. */
export function authorSelectionWasCommitted(db: Database.Database, input: Assignment) {
  if (input.selection.kind !== 'NEW') return false;
  const existing = db.prepare('SELECT 1 FROM creation_authors WHERE id=?').get(input.selection.requestId);
  if (!existing) return false;
  const hash = db
    .prepare(
      `SELECT json_extract(payload_json,'$.selectionRequestHash') FROM change_events
     WHERE entity_type='AUTHOR' AND entity_id=? AND operation='CREATE' ORDER BY rowid DESC LIMIT 1`,
    )
    .pluck()
    .get(input.selection.requestId);
  if (hash !== requestHash(input)) throw new Error('AUTHOR_REQUEST_CONFLICT');
  return true;
}

export function createSelectedAuthor(storage: LibraryStorage, input: Assignment) {
  const selection = input.selection;
  if (selection.kind !== 'NEW') throw new Error('AUTHOR_SELECTION_INVALID');
  if (authorNameMatch(storage.db, selection.fields.name).token !== selection.nameMatchToken)
    throw new Error('AUTHOR_CANDIDATES_CHANGED');
  const timestamp = new Date().toISOString();
  storage.db
    .prepare(`INSERT INTO creation_authors(id,name,avatar_data_url,created_at,updated_at) VALUES(?,?,?,?,?)`)
    .run(selection.requestId, selection.fields.name, selection.fields.avatarDataUrl, timestamp, timestamp);
  storage.recordChange('AUTHOR', selection.requestId, 'CREATE', {
    name: selection.fields.name,
    selectionRequestHash: requestHash(input),
  });
  return selection.requestId;
}
