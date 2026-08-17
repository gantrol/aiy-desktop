import type Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type { ContentLocale, LocalizedTitleDto } from '@/shared/contracts';
import { resolveLocalizedTitle } from '@/shared/localized-title';
import { type JsonMap, text } from '@/main/database/core/values';

export type LocalizedTitleOwner = 'ALBUM' | 'PROMPT_SERIES';

const specs = {
  ALBUM: {
    ownerTable: 'albums',
    localizationTable: 'album_localizations',
    ownerColumn: 'album_id',
  },
  PROMPT_SERIES: {
    ownerTable: 'prompt_series',
    localizationTable: 'prompt_series_localizations',
    ownerColumn: 'prompt_series_id',
  },
} as const;

const QUERY_BATCH_SIZE = 400;

export function titleLocalizationsByOwner(
  db: Database.Database,
  owner: LocalizedTitleOwner,
  ownerIds: readonly string[],
) {
  const spec = specs[owner];
  const ids = [...new Set(ownerIds.filter(Boolean))];
  const result = new Map<string, LocalizedTitleDto[]>();
  for (let offset = 0; offset < ids.length; offset += QUERY_BATCH_SIZE) {
    const batch = ids.slice(offset, offset + QUERY_BATCH_SIZE);
    const rows = db
      .prepare(
        `SELECT ${spec.ownerColumn} AS owner_id, locale, title
        FROM ${spec.localizationTable}
        WHERE ${spec.ownerColumn} IN (${batch.map(() => '?').join(', ')})
        ORDER BY ${spec.ownerColumn}, locale, id`,
      )
      .all(...batch) as JsonMap[];
    for (const row of rows) {
      const ownerId = text(row.owner_id);
      const items = result.get(ownerId) ?? [];
      items.push({ locale: text(row.locale), title: text(row.title) });
      result.set(ownerId, items);
    }
  }
  return result;
}

export function resolveStoredTitle(row: JsonMap, locale: ContentLocale, localizations: readonly LocalizedTitleDto[]) {
  return resolveLocalizedTitle(
    {
      title: text(row.title),
      titleLocale: text(row.title_locale) || 'zh',
      localizations,
    },
    locale,
  );
}

export function writeLocalizedTitle(
  db: Database.Database,
  owner: LocalizedTitleOwner,
  ownerId: string,
  locale: ContentLocale,
  title: string,
) {
  const spec = specs[owner];
  const canonicalLocale = locale.trim();
  const canonicalTitle = title.trim();
  if (!canonicalLocale || !canonicalTitle) throw new Error('A localized title requires a locale and title');
  const row = db
    .prepare(`SELECT title_locale FROM ${spec.ownerTable} WHERE id = ? AND deleted_at IS NULL`)
    .get(ownerId) as JsonMap | undefined;
  if (!row) throw new Error(`${owner === 'ALBUM' ? 'Album' : 'Prompt series'} not found`);
  if (text(row.title_locale) === canonicalLocale) {
    db.prepare(`UPDATE ${spec.ownerTable} SET title = ? WHERE id = ?`).run(canonicalTitle, ownerId);
    return { primary: true };
  }
  db.prepare(
    `INSERT INTO ${spec.localizationTable}(id, ${spec.ownerColumn}, locale, title)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(${spec.ownerColumn}, locale) DO UPDATE SET title = excluded.title`,
  ).run(ulid(), ownerId, canonicalLocale, canonicalTitle);
  return { primary: false };
}

export function replaceTitleLocalizations(
  db: Database.Database,
  owner: LocalizedTitleOwner,
  ownerId: string,
  primaryLocale: ContentLocale,
  localizations: readonly LocalizedTitleDto[],
) {
  const spec = specs[owner];
  db.prepare(`DELETE FROM ${spec.localizationTable} WHERE ${spec.ownerColumn} = ?`).run(ownerId);
  const seen = new Set<string>();
  for (const localization of localizations) {
    const locale = localization.locale.trim();
    const title = localization.title.trim();
    if (!locale || !title || locale === primaryLocale || seen.has(locale)) continue;
    seen.add(locale);
    db.prepare(
      `INSERT INTO ${spec.localizationTable}(id, ${spec.ownerColumn}, locale, title)
      VALUES (?, ?, ?, ?)`,
    ).run(ulid(), ownerId, locale, title);
  }
}
