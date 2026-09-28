import { randomUUID } from 'node:crypto';
import { CreationCopyRepository } from '@/main/database/creations/creation-copy-repository';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import { now } from '@/main/database/core/values';
import type {
  CreationOutlineCommand,
  CreationOutlineResult,
  CreationOutlineTarget,
} from '@/shared/contracts/creation-outline';

type Target = Pick<CreationOutlineTarget, 'kind' | 'id'>;
interface Membership {
  id: string;
  album_id: string;
  target_type: Target['kind'];
  target_id: string;
  sort_order: number;
  updated_at: string;
}
interface Position {
  target: Target;
  albumId: string | null;
  membership: Membership | null;
  parentCreationItemId: string | null;
  childSortOrder: number | null;
  branch: { id: string; parent: string | null; album: string | null; changed: string }[];
}
type Failure = Extract<CreationOutlineResult, { kind: 'error' }>['code'];
class OutlineError extends Error {
  constructor(readonly code: Failure) {
    super(code);
  }
}
const key = (target: Target) => target.kind + ':' + target.id;

function branchIds(root: string, children: ReadonlyMap<string, readonly string[]>) {
  const ids = new Set<string>();
  const pending = [root];
  while (pending.length) {
    const id = pending.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return ids;
}

/** Batch the existing ownership commands; do not duplicate their form/media ownership rules. */
export function createCreationOutlineApi(repositories: LibraryDatabaseRepositories) {
  const { db, storage, albums, creationItems } = repositories;
  const undoEntries = new Map<string, { before: Position[]; after: Position[] }>();

  function positions(targets: Target[]): Position[] {
    const ids = [...new Set(targets.map((target) => target.id))];
    const rows = db
      .prepare(
        "SELECT id, album_id, target_type, target_id, sort_order, updated_at FROM album_members WHERE deleted_at IS NULL AND target_type IN ('ALBUM', 'CREATION_ITEM') AND target_id IN (" +
          ids.map(() => '?').join(',') +
          ')',
      )
      .all(...ids) as Membership[];
    const byTarget = new Map<string, Membership>();
    for (const row of rows) {
      const rowKey = row.target_type + ':' + row.target_id;
      if (byTarget.has(rowKey)) throw new OutlineError('CHANGED');
      byTarget.set(rowKey, row);
    }
    const branches = db
      .prepare(
        `WITH RECURSIVE branch(id) AS (
      SELECT item.id FROM creation_items item JOIN json_each(?) roots ON roots.value = item.id
      UNION SELECT edge.creation_item_id FROM branch
        JOIN creation_item_parents edge ON edge.parent_creation_item_id = branch.id
        JOIN creation_items child ON child.id = edge.creation_item_id AND child.deleted_at IS NULL
      LIMIT 4001
    ) SELECT item.id, edge.parent_creation_item_id AS parent, edge.sort_order,
      member.album_id AS album, item.updated_at AS changed
    FROM branch JOIN creation_items item ON item.id = branch.id
    LEFT JOIN creation_item_parents edge ON edge.creation_item_id = item.id
    LEFT JOIN album_members member ON member.target_type = 'CREATION_ITEM' AND member.target_id = item.id AND member.deleted_at IS NULL
    ORDER BY item.id LIMIT 4001`,
      )
      .all(JSON.stringify(targets.filter((target) => target.kind === 'CREATION_ITEM').map((target) => target.id))) as {
      id: string;
      parent: string | null;
      sort_order: number | null;
      album: string | null;
      changed: string;
    }[];
    if (branches.length > 4000) throw new OutlineError('UNAVAILABLE');
    const branchById = new Map(branches.map((row) => [row.id, row]));
    const children = new Map<string, string[]>();
    for (const row of branches) {
      if (!row.parent) continue;
      const siblings = children.get(row.parent) ?? [];
      siblings.push(row.id);
      children.set(row.parent, siblings);
    }
    return targets.map((target) => {
      const membership = byTarget.get(key(target)) ?? null;
      const own = target.kind === 'CREATION_ITEM' ? branchById.get(target.id) : undefined;
      const included = own ? branchIds(own.id, children) : new Set<string>();
      const branch = own
        ? branches
            .filter((row) => included.has(row.id))
            .map(({ id, parent, album, changed }) => ({ id, parent, album, changed }))
        : [];
      return {
        target,
        albumId: membership?.album_id ?? null,
        membership,
        parentCreationItemId: own?.parent ?? null,
        childSortOrder: own?.sort_order ?? null,
        branch,
      };
    });
  }

  function context(targets: Target[]) {
    const albumRows = db.prepare('SELECT id, archived_at, deleted_at FROM albums').all() as {
      id: string;
      archived_at: string | null;
      deleted_at: string | null;
    }[];
    const albumById = new Map(albumRows.map((row) => [row.id, row]));
    const parents = new Map(
      (
        db
          .prepare("SELECT target_id, album_id FROM album_members WHERE target_type = 'ALBUM' AND deleted_at IS NULL")
          .all() as { target_id: string; album_id: string }[]
      ).map((row) => [row.target_id, row.album_id]),
    );
    const assertAlbum = (albumId: string | null) => {
      const visited = new Set<string>();
      for (let current = albumId; current; current = parents.get(current) ?? null) {
        const album = albumById.get(current);
        if (visited.has(current) || !album || album.archived_at || album.deleted_at)
          throw new OutlineError('UNAVAILABLE');
        visited.add(current);
      }
    };
    const creationIds = targets.filter((target) => target.kind === 'CREATION_ITEM').map((target) => target.id);
    const availableCreations = new Set(
      creationIds.length
        ? (
            db
              .prepare(
                'SELECT id FROM creation_items WHERE deleted_at IS NULL AND archived_at IS NULL AND id IN (' +
                  creationIds.map(() => '?').join(',') +
                  ')',
              )
              .all(...creationIds) as { id: string }[]
          ).map((row) => row.id)
        : [],
    );
    for (const target of targets) {
      if (target.kind === 'ALBUM') assertAlbum(target.id);
      else if (!availableCreations.has(target.id)) throw new OutlineError('UNAVAILABLE');
    }
    return { parents, assertAlbum };
  }

  function move(position: Position, albumId: string | null, parentCreationItemId: string | null = null) {
    if (position.target.kind === 'ALBUM') albums.move({ albumId: position.target.id, parentAlbumId: albumId });
    else creationItems.move({ creationItemId: position.target.id, albumId, parentCreationItemId });
  }

  function execute(command: CreationOutlineCommand): CreationOutlineResult {
    if (command.kind === 'copy-form-owner') {
      const item = creationItems.findForEntity(command.entity);
      if (!item) throw new OutlineError('UNAVAILABLE');
      return execute({
        kind: 'copy',
        targets: [{ kind: 'CREATION_ITEM', id: item.id, expectedAlbumId: item.albumId }],
        albumId: command.albumId,
      });
    }
    if (command.kind === 'undo') {
      const entry = undoEntries.get(command.token);
      if (!entry) throw new OutlineError('CHANGED');
      db.transaction(() => {
        const current = positions(entry.after.map((position) => position.target));
        if (JSON.stringify(current) !== JSON.stringify(entry.after)) throw new OutlineError('CHANGED');
        const { assertAlbum } = context(current.map((position) => position.target));
        for (const position of [...current, ...entry.before]) assertAlbum(position.albumId);
        for (const position of entry.before) {
          move(position, position.albumId, position.parentCreationItemId);
          if (position.childSortOrder !== null)
            db.prepare('UPDATE creation_item_parents SET sort_order = ? WHERE creation_item_id = ?').run(
              position.childSortOrder,
              position.target.id,
            );
          if (position.membership) {
            const timestamp = now();
            db.prepare(
              'UPDATE album_members SET sort_order = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
            ).run(position.membership.sort_order, timestamp, position.membership.id);
            storage.recordChange('ALBUM_MEMBER', position.membership.id, 'REORDER', {
              sortOrder: position.membership.sort_order,
            });
          }
        }
      }).immediate();
      undoEntries.delete(command.token);
      return { kind: 'undone', count: entry.before.length };
    }

    const snapshot = db
      .transaction(() => {
        const targets = [...new Map(command.targets.map((target) => [key(target), target])).values()];
        const { parents, assertAlbum } = context(targets);
        assertAlbum(command.albumId);
        const current = positions(targets);
        const parentId = command.kind === 'move' ? (command.parentCreationItemId ?? null) : null;
        if (parentId) {
          if (targets.some((target) => target.kind !== 'CREATION_ITEM')) throw new OutlineError('INVALID_DESTINATION');
          const parent = creationItems.find(parentId);
          if (!parent || parent.lifecycle !== 'ACTIVE') throw new OutlineError('UNAVAILABLE');
          if (
            parent.albumId !== command.albumId ||
            current.some((position) => position.branch.some((row) => row.id === parentId))
          )
            throw new OutlineError('INVALID_DESTINATION');
        }
        const selectedAlbums = new Set(targets.filter((target) => target.kind === 'ALBUM').map((target) => target.id));
        const covered = (albumId: string | null) => {
          const seen = new Set<string>();
          for (let ancestor = albumId; ancestor && !seen.has(ancestor); ancestor = parents.get(ancestor) ?? null) {
            if (selectedAlbums.has(ancestor)) return true;
            seen.add(ancestor);
          }
          return false;
        };
        if (covered(command.albumId)) throw new OutlineError('INVALID_DESTINATION');
        for (const [index, position] of current.entries()) {
          if (targets[index].expectedAlbumId !== undefined && position.albumId !== targets[index].expectedAlbumId)
            throw new OutlineError('CHANGED');
          if (
            targets[index].expectedParentCreationItemId !== undefined &&
            position.parentCreationItemId !== targets[index].expectedParentCreationItemId
          )
            throw new OutlineError('CHANGED');
          assertAlbum(position.albumId);
        }
        const before = current.filter(
          (position) =>
            !covered(position.albumId) &&
            !current.some((other) => other !== position && other.branch.some((row) => row.id === position.target.id)) &&
            (command.kind === 'copy' ||
              position.albumId !== command.albumId ||
              position.parentCreationItemId !== parentId),
        );
        if (command.kind === 'copy') {
          const ids = new CreationCopyRepository(repositories).copy(
            before.map((position) => ({ ...position.target, expectedAlbumId: position.albumId })),
            command.albumId,
          );
          return { before, after: [], copiedIds: ids };
        }
        for (const position of before) move(position, command.albumId, parentId);
        return { before, after: before.length ? positions(before.map((position) => position.target)) : [] };
      })
      .immediate();
    if (snapshot.copiedIds) return { kind: 'copied', count: snapshot.copiedIds.length, ids: snapshot.copiedIds };
    if (!snapshot.before.length) return { kind: 'moved', count: 0, undoToken: null };
    const token = randomUUID();
    undoEntries.set(token, snapshot);
    if (undoEntries.size > 20) undoEntries.delete(undoEntries.keys().next().value!);
    return { kind: 'moved', count: snapshot.before.length, undoToken: token };
  }

  return {
    creationOutlineCommand(command: CreationOutlineCommand): CreationOutlineResult {
      try {
        return execute(command);
      } catch (reason) {
        if (reason instanceof Error && reason.message === 'CREATION_PARENT_CYCLE')
          return { kind: 'error', code: 'INVALID_DESTINATION' };
        return { kind: 'error', code: reason instanceof OutlineError ? reason.code : 'FAILED' };
      }
    },
  };
}
