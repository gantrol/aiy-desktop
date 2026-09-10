import type { LibraryStorage } from '@/main/database/core/storage';
import { AlbumRepository } from '@/main/database/albums/album-repository';

const key = 'default_notes_album_id';

/** Called inside the first meaningful note save, never when opening a blank editor. */
export function ensureDefaultNotesAlbum(storage: LibraryStorage): string {
  const saved = storage.db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as
    { value: string } | undefined;
  const albums = new AlbumRepository(storage);
  if (saved) {
    try {
      return albums.getActive(saved.value).id;
    } catch {
      // A removed or archived default is replaced lazily; existing notes keep their location.
    }
  }
  const existing = storage.db
    .prepare(
      "SELECT id FROM albums WHERE title = '贴贴便签' AND deleted_at IS NULL AND archived_at IS NULL ORDER BY created_at, id LIMIT 1",
    )
    .get() as { id: string } | undefined;
  const id = existing?.id ?? albums.create({ title: '贴贴便签', titleLocale: 'zh' }).id;
  storage.db
    .prepare('INSERT INTO app_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, id);
  return id;
}
