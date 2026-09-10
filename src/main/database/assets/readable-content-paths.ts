import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { LibraryStorage } from '@/main/database/core/storage';
import {
  safeDirectoryLabel,
  isPathInsideOrEqual,
  directoryKey,
  collisionKey,
} from '@/main/database/assets/library-file-view-values';
import { now } from '@/main/database/core/values';

export async function readablePath(root: string, relative: string, create = false) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/u).some((part) => part === '..' || /trash/iu.test(part)))
    throw new Error('Invalid readable library path');
  const canonicalRoot = await realpath(root);
  let current = canonicalRoot;
  for (const part of relative.split(/[\\/]/u).filter(Boolean)) {
    current = path.join(current, part);
    if (!isPathInsideOrEqual(canonicalRoot, current)) throw new Error('Invalid readable library path');
    if (create)
      await mkdir(current).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
      });
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory() || !isPathInsideOrEqual(canonicalRoot, await realpath(current)))
      throw new Error('Readable library directory was replaced');
  }
  return current;
}

export async function allocateReadableDirectory(root: string, parent: string, label: string) {
  await readablePath(root, parent, true);
  for (let index = 1; index <= 10000; index++) {
    const relative = path.join(parent, `${safeDirectoryLabel(label, '内容')}${index === 1 ? '' : ` (${index})`}`);
    try {
      await mkdir(path.join(root, relative));
      return relative;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('No available readable directory name');
}

/** Uses the same album-directory index as image projections. */
export async function readableAlbumDirectory(
  storage: LibraryStorage,
  albumId: string | null,
  seen = new Set<string>(),
): Promise<string> {
  if (!albumId) {
    await readablePath(storage.libraryRoot, '图集/未归档', true);
    return path.join('图集', '未归档');
  }
  if (seen.has(albumId)) throw new Error('Album hierarchy contains a cycle');
  seen.add(albumId);
  const album = storage.db
    .prepare(
      `SELECT a.title, (SELECT m.album_id FROM album_members m WHERE m.target_type = 'ALBUM' AND m.target_id = a.id AND m.deleted_at IS NULL LIMIT 1) parent_id FROM albums a WHERE a.id = ? AND a.deleted_at IS NULL AND a.archived_at IS NULL`,
    )
    .get(albumId) as { title: string; parent_id: string | null } | undefined;
  if (!album) throw new Error('Album unavailable');
  const parent = album.parent_id ? await readableAlbumDirectory(storage, album.parent_id, seen) : '图集';
  const key = directoryKey('ALBUM', albumId),
    label = safeDirectoryLabel(album.title, '图集');
  const previous = storage.db
    .prepare(
      "SELECT relative_path, preferred_name FROM file_projection_directories WHERE projection_key = ? AND state = 'ACTIVE'",
    )
    .get(key) as { relative_path: string; preferred_name: string } | undefined;
  if (
    previous &&
    previous.preferred_name === label &&
    path.normalize(path.dirname(previous.relative_path)) === path.normalize(parent)
  ) {
    try {
      await readablePath(storage.libraryRoot, previous.relative_path);
      return previous.relative_path;
    } catch {
      /* Allocate beside replaced paths. */
    }
  }
  const relative = await allocateReadableDirectory(storage.libraryRoot, parent, label),
    allocated = path.basename(relative),
    timestamp = now();
  storage.db
    .prepare(
      `INSERT INTO file_projection_directories(projection_key, context_type, context_id, parent_projection_key, relative_path, relative_path_key, previous_relative_path, preferred_name, allocated_name, allocated_name_key, state, reserved_until, last_error, verified_at, retired_at, created_at, updated_at)
    VALUES (?, 'ALBUM', ?, ?, ?, ?, NULL, ?, ?, ?, 'ACTIVE', NULL, NULL, ?, NULL, ?, ?)
    ON CONFLICT(projection_key) DO UPDATE SET previous_relative_path = relative_path, parent_projection_key = excluded.parent_projection_key, relative_path = excluded.relative_path, relative_path_key = excluded.relative_path_key, preferred_name = excluded.preferred_name, allocated_name = excluded.allocated_name, allocated_name_key = excluded.allocated_name_key, state = 'ACTIVE', verified_at = excluded.verified_at, updated_at = excluded.updated_at`,
    )
    .run(
      key,
      albumId,
      album.parent_id ? directoryKey('ALBUM', album.parent_id) : null,
      relative,
      collisionKey(relative),
      label,
      allocated,
      collisionKey(allocated),
      timestamp,
      timestamp,
      timestamp,
    );
  return relative;
}
