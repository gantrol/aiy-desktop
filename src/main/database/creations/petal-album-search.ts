import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, text } from '@/main/database/core/values';
import { resolveStoredTitle, titleLocalizationsByOwner } from '@/main/database/core/title-localization';
import { MATERIAL_LIBRARY_ALBUM_INTENT } from '@/main/database/albums/album-intents';
import type { PinSearch, PinSummary } from '@/shared/contracts/petal-board';

/** Search album metadata and paths; neither album members nor media bytes are loaded. */
export function searchPetalAlbums(storage: LibraryStorage, input: PinSearch): PinSummary[] {
  const rows = storage.db
    .prepare(
      `WITH RECURSIVE unavailable(id) AS (
    SELECT id FROM albums WHERE deleted_at IS NOT NULL OR archived_at IS NOT NULL
    UNION
    SELECT member.target_id FROM album_members member JOIN unavailable parent ON parent.id = member.album_id
    WHERE member.target_type = 'ALBUM' AND member.deleted_at IS NULL
  ), parents AS (
    SELECT target_id, album_id, row_number() OVER (PARTITION BY target_id ORDER BY updated_at DESC, id) AS rank
    FROM album_members WHERE target_type = 'ALBUM' AND deleted_at IS NULL
  ) SELECT album.*, parent.album_id AS parent_id
    FROM albums album LEFT JOIN parents parent ON parent.target_id = album.id AND parent.rank = 1
    WHERE album.id NOT IN (SELECT id FROM unavailable)
    ORDER BY album.updated_at DESC, album.id`,
    )
    .all() as JsonMap[];
  const localizations = titleLocalizationsByOwner(
    storage.db,
    'ALBUM',
    rows.map((row) => text(row.id)),
  );
  const titles = new Map(
    rows.map((row) => [
      text(row.id),
      resolveStoredTitle(row, input.locale ?? 'zh', localizations.get(text(row.id)) ?? []),
    ]),
  );
  const byId = new Map(rows.map((row) => [text(row.id), row]));
  const query = input.query.normalize('NFKC').trim().toLocaleLowerCase();
  const result: PinSummary[] = [];
  for (const row of rows) {
    if ((row.intent === MATERIAL_LIBRARY_ALBUM_INTENT) !== (input.kind === 'MATERIAL_ALBUM')) continue;
    const id = text(row.id);
    const parents: string[] = [];
    const visited = new Set([id]);
    let parentId = text(row.parent_id);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      parents.unshift(titles.get(parentId) ?? text(parent.title));
      parentId = text(parent.parent_id);
    }
    const title = titles.get(id) ?? text(row.title);
    if (![...parents, title, id].join(' / ').normalize('NFKC').toLocaleLowerCase().includes(query)) continue;
    result.push({
      source: { kind: input.kind, id },
      title,
      parentPath: parents.join(' / '),
      preview: '',
      mediaUrl: null,
    });
  }
  return result.slice(input.offset, input.offset + 30);
}
