import type Database from 'better-sqlite3';
import type { GalleryItemDto, GalleryMaterialDto, Locale } from '@/shared/contracts';
import { creationOutputCandidatesSql } from '@/main/database/assets/gallery-creation-relationships-sql';
import type { AssetNavigationDto } from '@/shared/contracts/asset-navigation';
import { resolveStoredTitle, titleLocalizationsByOwner } from '@/main/database/core/title-localization';
import { type JsonMap, text } from '@/main/database/core/values';

export function createAssetNavigationApi(
  db: Database.Database,
  gallery: {
    getAsset(assetId: string, locale: Locale): GalleryItemDto | null;
    getMaterial(materialId: string, locale: Locale): GalleryMaterialDto | null;
  },
) {
  return {
    getGalleryMaterial(materialId: string, locale: Locale) {
      return gallery.getMaterial(materialId, locale);
    },
    getAssetNavigation(assetId: string, locale: Locale) {
      const material = gallery.getAsset(assetId, locale);
      return material ? readAssetNavigation(db, material, locale) : null;
    },
  };
}

/** Read only navigation identities for one visible asset, without generation inputs or file I/O. */
export function readAssetNavigation(
  db: Database.Database,
  material: GalleryItemDto,
  locale: Locale,
): AssetNavigationDto {
  const assetId = material.asset.id;
  const creations = db
    .prepare(
      `
    SELECT DISTINCT series.id, series.title, series.title_locale,
      series.deleted_at, series.archived_at, version.id AS version_id, version.version_no
    FROM (${creationOutputCandidatesSql}) source
    JOIN prompt_series series ON series.id = source.series_id
    LEFT JOIN prompt_versions version ON version.series_id = series.id AND version.version_no = source.version_no
    WHERE source.asset_id = ?
    ORDER BY series.id, version.version_no DESC
  `,
    )
    .all(assetId) as JsonMap[];
  const titles = titleLocalizationsByOwner(
    db,
    'PROMPT_SERIES',
    creations.map((row) => text(row.id)),
  );
  const terms = db
    .prepare(
      `
    SELECT DISTINCT term.id, term.archived_at, term.current_revision_id,
      COALESCE(localized.title, revision.title) AS title
    FROM (
      SELECT term_id FROM term_media_links WHERE image_asset_id = ? AND deleted_at IS NULL
      UNION SELECT term_id FROM term_evidence WHERE image_asset_id = ?
    ) source
    JOIN terms term ON term.id = source.term_id
    LEFT JOIN term_revisions revision ON revision.id = term.current_revision_id
    LEFT JOIN term_localizations localized ON localized.term_revision_id = revision.id AND localized.locale = ?
    ORDER BY term.id
  `,
    )
    .all(assetId, assetId, locale) as JsonMap[];
  return {
    material,
    sources: [
      ...creations.map((row) => ({
        kind: 'CREATION' as const,
        id: text(row.id),
        title: resolveStoredTitle(row, locale, titles.get(text(row.id)) ?? []),
        versionId: row.version_id ? text(row.version_id) : null,
        versionNo: row.version_no == null ? null : Number(row.version_no),
        available: !row.deleted_at && !row.archived_at,
      })),
      ...terms.map((row) => ({
        kind: 'TERM' as const,
        id: text(row.id),
        title: text(row.title),
        available: !row.archived_at && Boolean(row.current_revision_id),
      })),
    ],
  };
}
