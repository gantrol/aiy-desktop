import type {
  AddMaterialsToDestinationsInput,
  AddMaterialsToDestinationsResult,
  AlbumCreateFromMaterialsInput,
  AlbumCreateFromMaterialsResult,
} from '@/shared/contracts';
import type { AlbumRepository } from '@/main/database/album-repository';
import type { DictionaryRepository } from '@/main/database/dictionary-repository';
import type { MaterialAlbumRepository } from '@/main/database/material-album-repository';
import type { LibraryStorage } from '@/main/database/storage';
import { type JsonMap, text } from '@/main/database/values';

interface ResolvedMaterial {
  materialId: string;
  kind: 'IMAGE' | 'TEXT';
  imageAssetId: string | null;
}

export class MaterialMembershipRepository {
  constructor(
    private readonly storage: LibraryStorage,
    private readonly albums: AlbumRepository,
    private readonly materialAlbums: MaterialAlbumRepository,
    private readonly dictionary: DictionaryRepository,
  ) {}

  private get db() {
    return this.storage.db;
  }

  addToDestinations(input: AddMaterialsToDestinationsInput): AddMaterialsToDestinationsResult {
    const albumIds = [...new Set(input.albumIds)];
    const termIds = [...new Set(input.termIds)];
    if (albumIds.length + termIds.length === 0) throw new Error('Choose at least one destination');
    if (input.targets.length === 0) throw new Error('Choose at least one material');

    return this.db
      .transaction(() => {
        const resolvedById = new Map<string, ResolvedMaterial>();
        for (const resolved of this.resolveTargets(input.targets)) resolvedById.set(resolved.materialId, resolved);
        const resolved = [...resolvedById.values()];
        if (termIds.length > 0 && resolved.some((material) => material.kind !== 'IMAGE')) {
          throw new Error('Dictionary terms accept image materials only');
        }

        const materialIds = resolved.map((material) => material.materialId);
        const imageAssetIds = resolved.flatMap((material) => (material.imageAssetId ? [material.imageAssetId] : []));
        const albumCountBefore = this.countAlbumMemberships(albumIds, materialIds);
        const termCountBefore = this.countTermMedia(termIds, imageAssetIds);

        const materialLibraryAlbumIds = this.materialLibraryAlbumIds(albumIds);
        for (const albumId of albumIds) {
          if (materialLibraryAlbumIds.has(albumId)) {
            this.materialAlbums.addMany(
              {
                albumId,
                targets: materialIds.map((materialId) => ({ kind: 'MATERIAL', materialId })),
              },
              { returnDto: false },
            );
          } else {
            this.albums.addMembers(
              {
                albumId,
                members: materialIds.map((targetId) => ({ targetType: 'MATERIAL', targetId })),
              },
              { returnDto: false },
            );
          }
        }
        for (const termId of termIds) {
          this.dictionary.addTermMedia({ termId, assetIds: imageAssetIds }, { returnItems: false });
        }

        return {
          materialIds,
          albumIds,
          termIds,
          addedAlbumMembershipCount: this.countAlbumMemberships(albumIds, materialIds) - albumCountBefore,
          addedTermMediaCount: this.countTermMedia(termIds, imageAssetIds) - termCountBefore,
          albumMaterialCounts: this.readAlbumMaterialCounts(albumIds),
        };
      })
      .immediate();
  }

  createAlbumFromMaterials(input: AlbumCreateFromMaterialsInput): AlbumCreateFromMaterialsResult {
    if (input.targets.length === 0) throw new Error('Choose at least one material');
    return this.db
      .transaction(() => {
        const created = this.albums.create({ title: input.title });
        const result = this.addToDestinations({
          targets: input.targets,
          albumIds: [created.id],
          termIds: [],
        });
        const album = this.albums.list().find((candidate) => candidate.id === created.id);
        if (!album) throw new Error('Album not found after creation');
        return {
          album,
          capturedMaterialCount: result.materialIds.length,
        };
      })
      .immediate();
  }

  private resolveTargets(targets: AddMaterialsToDestinationsInput['targets']) {
    const materialIds = [
      ...new Set(targets.flatMap((target) => (target.kind === 'MATERIAL' ? [target.materialId] : []))),
    ];
    const imageAssetIds = [
      ...new Set(targets.flatMap((target) => (target.kind === 'IMAGE_ASSET' ? [target.imageAssetId] : []))),
    ];
    const byMaterialId = new Map<string, ResolvedMaterial>();
    if (materialIds.length > 0) {
      const slots = materialIds.map(() => '?').join(', ');
      const rows = this.db
        .prepare(
          `SELECT material.id, material.kind, material.image_asset_id
          FROM materials material
          LEFT JOIN image_assets asset ON asset.id = material.image_asset_id
          WHERE material.id IN (${slots}) AND material.deleted_at IS NULL
            AND (material.kind = 'TEXT' OR asset.deleted_at IS NULL)`,
        )
        .all(...materialIds) as JsonMap[];
      for (const row of rows) {
        const kind = text(row.kind) as ResolvedMaterial['kind'];
        byMaterialId.set(text(row.id), {
          materialId: text(row.id),
          kind,
          imageAssetId: kind === 'IMAGE' ? text(row.image_asset_id) : null,
        });
      }
      if (byMaterialId.size !== materialIds.length) throw new Error('Material not found');
    }

    const imageMaterialIds = this.albums.ensureImageMaterials(imageAssetIds);
    const byImageAssetId = new Map(
      imageAssetIds.map((imageAssetId, index) => [
        imageAssetId,
        { materialId: imageMaterialIds[index]!, kind: 'IMAGE' as const, imageAssetId },
      ]),
    );
    return targets.map((target) =>
      target.kind === 'MATERIAL'
        ? (byMaterialId.get(target.materialId) as ResolvedMaterial)
        : (byImageAssetId.get(target.imageAssetId) as ResolvedMaterial),
    );
  }

  private materialLibraryAlbumIds(albumIds: string[]): Set<string> {
    if (albumIds.length === 0) return new Set();
    const rows = this.db
      .prepare(
        `SELECT id, intent FROM albums
        WHERE id IN (${albumIds.map(() => '?').join(', ')}) AND deleted_at IS NULL`,
      )
      .all(...albumIds) as JsonMap[];
    if (rows.length !== albumIds.length) throw new Error('Album not found');
    return new Set(rows.filter((row) => text(row.intent) === 'MATERIAL_LIBRARY').map((row) => text(row.id)));
  }

  private countAlbumMemberships(albumIds: string[], materialIds: string[]) {
    if (albumIds.length === 0 || materialIds.length === 0) return 0;
    const albumSlots = albumIds.map(() => '?').join(', ');
    const materialSlots = materialIds.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `SELECT count(*) AS count FROM album_members
      WHERE album_id IN (${albumSlots}) AND target_type = 'MATERIAL'
        AND target_id IN (${materialSlots}) AND deleted_at IS NULL`,
      )
      .get(...albumIds, ...materialIds) as JsonMap;
    return Number(row.count);
  }

  private readAlbumMaterialCounts(albumIds: string[]): Record<string, number> {
    if (albumIds.length === 0) return {};
    const rows = this.db
      .prepare(
        `SELECT album_id, count(*) AS count FROM album_members
        WHERE album_id IN (${albumIds.map(() => '?').join(', ')})
          AND target_type = 'MATERIAL' AND deleted_at IS NULL
        GROUP BY album_id`,
      )
      .all(...albumIds) as JsonMap[];
    const counts = Object.fromEntries(albumIds.map((albumId) => [albumId, 0]));
    for (const row of rows) counts[text(row.album_id)] = Number(row.count);
    return counts;
  }

  private countTermMedia(termIds: string[], imageAssetIds: string[]) {
    if (termIds.length === 0 || imageAssetIds.length === 0) return 0;
    const termSlots = termIds.map(() => '?').join(', ');
    const assetSlots = imageAssetIds.map(() => '?').join(', ');
    const row = this.db
      .prepare(
        `SELECT count(*) AS count FROM term_media_links
      WHERE term_id IN (${termSlots}) AND image_asset_id IN (${assetSlots})
        AND deleted_at IS NULL`,
      )
      .get(...termIds, ...imageAssetIds) as JsonMap;
    return Number(row.count);
  }
}
