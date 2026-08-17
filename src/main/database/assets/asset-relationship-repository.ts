import type {
  AssetCreationInputPackUseDto,
  AssetCreationRelationshipDto,
  AssetDirectPackSourceDto,
  AssetRelationshipDto,
  AssetRelationshipPackIdentityDto,
  AssetRelationshipPackReleaseItemDto,
  AssetRelationshipRecipeUseDto,
  AssetRelationshipTermUseDto,
  AssetTermRelationshipDto,
  GenerationStatus,
  Locale,
  PromptCommonInputDto,
  PromptPackSourceReferenceDto,
  TermMediaRole,
} from '@/shared/contracts';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, text } from '@/main/database/core/values';
import { parsePromptCommonInput } from '@/main/database/generation/snapshot-content';
import { resolveStoredTitle, titleLocalizationsByOwner } from '@/main/database/core/title-localization';

interface CreationRow extends JsonMap {
  relationship_kind: 'GENERATION_RUN' | 'IMPORTED_OUTPUT';
}

interface PackSourceUse {
  dto: AssetCreationInputPackUseDto;
  releaseItemIds: Set<string>;
  directTermKeys: Set<string>;
  recipeByKey: Map<string, AssetCreationInputPackUseDto['viaRecipes'][number]>;
  referenceKeys: Set<string>;
}

function nullableText(value: unknown) {
  return value == null ? null : text(value);
}

function validPackSource(value: unknown): value is PromptPackSourceReferenceDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Partial<PromptPackSourceReferenceDto>;
  return Boolean(source.packId && source.packReleaseId && source.packReleaseItemId);
}

function packSources(value: unknown) {
  return Array.isArray(value) ? value.filter(validPackSource) : [];
}

export class AssetRelationshipRepository {
  private readonly db: LibraryStorage['db'];

  constructor(storage: LibraryStorage) {
    this.db = storage.db;
  }

  get(assetId: string, locale: Locale = 'zh'): AssetRelationshipDto {
    if (!this.db.prepare('SELECT 1 FROM image_assets WHERE id = ?').get(assetId)) {
      throw new Error('Image asset not found');
    }
    return {
      assetId,
      creations: this.creationRelationships(assetId, locale),
      termRelationships: this.termRelationships(assetId),
      directPackSources: this.directPackSources(assetId),
    };
  }

  private creationRelationships(assetId: string, locale: Locale): AssetCreationRelationshipDto[] {
    const rows = this.db
      .prepare(
        `
      SELECT 'GENERATION_RUN' AS relationship_kind, run.id AS relationship_id,
        run.id AS run_id, NULL AS imported_output_id, run.model_key, run.status AS run_status,
        run.created_at AS relationship_created_at, NULL AS relationship_deleted_at,
        series.id AS series_id, series.title, series.title_locale,
        series.deleted_at AS series_deleted_at,
        version.id AS prompt_version_id, version.version_no, version.user_intent,
        snapshot.id AS prompt_input_snapshot_id, snapshot.common_input_json
      FROM generation_runs run
      JOIN prompt_versions version ON version.id = run.prompt_version_id
      JOIN prompt_series series ON series.id = version.series_id
      JOIN prompt_input_snapshots snapshot ON snapshot.prompt_version_id = version.id
      WHERE run.result_asset_id = ?
      UNION ALL
      SELECT 'IMPORTED_OUTPUT' AS relationship_kind, imported.id AS relationship_id,
        NULL AS run_id, imported.id AS imported_output_id, imported.model_key, NULL AS run_status,
        imported.created_at AS relationship_created_at, imported.deleted_at AS relationship_deleted_at,
        series.id AS series_id, series.title, series.title_locale,
        series.deleted_at AS series_deleted_at,
        version.id AS prompt_version_id, version.version_no, version.user_intent,
        snapshot.id AS prompt_input_snapshot_id, snapshot.common_input_json
      FROM creation_output_imports imported
      JOIN prompt_series series ON series.id = imported.series_id
      LEFT JOIN prompt_versions version ON version.id = imported.prompt_version_id
      LEFT JOIN prompt_input_snapshots snapshot ON snapshot.prompt_version_id = version.id
      WHERE imported.image_asset_id = ? AND imported.deleted_at IS NULL
      ORDER BY relationship_created_at DESC, relationship_id DESC
    `,
      )
      .all(assetId, assetId) as CreationRow[];
    const seriesLocalizations = titleLocalizationsByOwner(
      this.db,
      'PROMPT_SERIES',
      rows.map((row) => text(row.series_id)),
    );

    return rows.map((row) => {
      const commonInput = row.prompt_version_id ? parsePromptCommonInput(row.common_input_json) : null;
      const directTerms = (commonInput?.directTerms ?? []).map((term) =>
        this.termUse(term.termId, term.termRevisionId),
      );
      const recipes = (commonInput?.recipes ?? []).map((recipe) => this.recipeUse(recipe));
      const title = resolveStoredTitle(row, locale, seriesLocalizations.get(text(row.series_id)) ?? []);
      return {
        kind: text(row.relationship_kind) as AssetCreationRelationshipDto['kind'],
        runId: nullableText(row.run_id),
        importedOutputId: nullableText(row.imported_output_id),
        series: {
          id: text(row.series_id),
          title: title,
          deletedAt: nullableText(row.series_deleted_at),
        },
        promptVersion: row.prompt_version_id
          ? {
              id: text(row.prompt_version_id),
              versionNo: Number(row.version_no),
              userInstruction: commonInput!.userInstruction,
              promptInputSnapshotId: text(row.prompt_input_snapshot_id),
            }
          : null,
        modelKey: nullableText(row.model_key),
        runStatus: row.run_status ? (text(row.run_status) as GenerationStatus) : null,
        directTerms,
        recipes,
        inputPackSources: commonInput ? this.inputPackSources(commonInput, directTerms, recipes) : [],
        createdAt: text(row.relationship_created_at),
        deletedAt: nullableText(row.relationship_deleted_at),
      };
    });
  }

  private termRelationships(assetId: string): AssetTermRelationshipDto[] {
    const rows = this.db
      .prepare(
        `
      SELECT 'EVIDENCE' AS relationship_kind, evidence.id AS relationship_id, evidence.term_id,
        term.current_revision_id, revision.title, revision.title_locale,
        evidence.verdict, evidence.note, NULL AS media_role,
        evidence.created_at AS relationship_created_at, NULL AS deleted_at
      FROM term_evidence evidence
      JOIN terms term ON term.id = evidence.term_id
      LEFT JOIN term_revisions revision ON revision.id = term.current_revision_id
      WHERE evidence.image_asset_id = ?
      UNION ALL
      SELECT 'MEDIA' AS relationship_kind, media.id AS relationship_id, media.term_id,
        term.current_revision_id, revision.title, revision.title_locale,
        NULL AS verdict, '' AS note, media.role AS media_role,
        media.created_at AS relationship_created_at, media.deleted_at
      FROM term_media_links media
      JOIN terms term ON term.id = media.term_id
      LEFT JOIN term_revisions revision ON revision.id = term.current_revision_id
      WHERE media.image_asset_id = ? AND media.deleted_at IS NULL
      ORDER BY relationship_created_at DESC, relationship_id DESC
    `,
      )
      .all(assetId, assetId) as JsonMap[];
    const revisionIds = [...new Set(rows.map((row) => text(row.current_revision_id)).filter(Boolean))];
    const localizations = new Map<string, Array<{ locale: string; title: string }>>();
    if (revisionIds.length) {
      const localizationRows = this.db
        .prepare(
          `SELECT term_revision_id, locale, title FROM term_localizations
          WHERE term_revision_id IN (${revisionIds.map(() => '?').join(',')})
          ORDER BY term_revision_id, locale, id`,
        )
        .all(...revisionIds) as JsonMap[];
      for (const localization of localizationRows) {
        const revisionId = text(localization.term_revision_id);
        const items = localizations.get(revisionId) ?? [];
        items.push({ locale: text(localization.locale), title: text(localization.title) });
        localizations.set(revisionId, items);
      }
    }
    return rows.map((row) => ({
      kind: text(row.relationship_kind) as AssetTermRelationshipDto['kind'],
      id: text(row.relationship_id),
      termId: text(row.term_id),
      currentTermRevisionId: nullableText(row.current_revision_id),
      title: text(row.title) || text(row.term_id),
      titleLocale: text(row.title_locale),
      localizations: localizations.get(text(row.current_revision_id)) ?? [],
      verdict: nullableText(row.verdict),
      note: text(row.note),
      mediaRole: row.media_role ? (text(row.media_role) as TermMediaRole) : null,
      createdAt: text(row.relationship_created_at),
      deletedAt: nullableText(row.deleted_at),
    }));
  }

  private directPackSources(assetId: string): AssetDirectPackSourceDto[] {
    const rows = this.db
      .prepare(
        `
      SELECT link.id AS link_id, link.local_object_type, link.local_object_id,
        link.local_revision_id, link.mapping_kind,
        pack.id AS pack_id, pack.display_name,
        release.id AS release_id, release.version AS release_version,
        item.id AS release_item_id, item.item_key, item.object_type, item.object_revision_id
      FROM pack_object_links link
      JOIN pack_release_items item ON item.id = link.release_item_id
      JOIN pack_releases release ON release.id = item.release_id
      JOIN packs pack ON pack.id = release.pack_id
      WHERE link.deleted_at IS NULL AND (
        (link.local_object_type IN ('ASSET', 'IMAGE_ASSET') AND link.local_object_id = ?)
        OR (link.local_object_type IN ('MATERIAL', 'MATERIAL_REVISION') AND EXISTS (
          SELECT 1 FROM materials material
          WHERE material.id = link.local_object_id AND material.image_asset_id = ?
        ))
      )
      ORDER BY pack.display_name, release.version, item.sort_order, item.id, link.id
    `,
      )
      .all(assetId, assetId) as JsonMap[];
    return rows.map((row) => ({
      id: text(row.link_id),
      pack: this.packIdentityFromRow(row),
      releaseItem: this.releaseItemFromRow(row),
      localObjectType: text(row.local_object_type),
      localObjectId: text(row.local_object_id),
      localRevisionId: text(row.local_revision_id),
      mappingKind: text(row.mapping_kind) as AssetDirectPackSourceDto['mappingKind'],
    }));
  }

  private inputPackSources(
    commonInput: PromptCommonInputDto,
    directTerms: AssetRelationshipTermUseDto[],
    recipes: AssetRelationshipRecipeUseDto[],
  ): AssetCreationInputPackUseDto[] {
    const grouped = new Map<string, PackSourceUse>();
    const termByKey = new Map(directTerms.map((term) => [`${term.termId}:${term.termRevisionId}`, term]));
    const recipeByUseId = new Map(recipes.map((recipe) => [recipe.useId, recipe]));

    const use = (source: PromptPackSourceReferenceDto) => {
      const sourceRecord = this.packSourceRecord(source);
      const key = `${source.packId}:${source.packReleaseId}`;
      let group = grouped.get(key);
      if (!group) {
        group = {
          dto: {
            pack: sourceRecord.pack,
            releaseItems: [],
            viaDirectTerms: [],
            viaRecipes: [],
            viaReferences: [],
          },
          releaseItemIds: new Set(),
          directTermKeys: new Set(),
          recipeByKey: new Map(),
          referenceKeys: new Set(),
        };
        grouped.set(key, group);
      }
      if (!group.releaseItemIds.has(sourceRecord.releaseItem.id)) {
        group.releaseItemIds.add(sourceRecord.releaseItem.id);
        group.dto.releaseItems.push(sourceRecord.releaseItem);
      }
      return group;
    };

    for (const term of commonInput.directTerms) {
      const termDto =
        termByKey.get(`${term.termId}:${term.termRevisionId}`) ?? this.termUse(term.termId, term.termRevisionId);
      for (const source of packSources(term.packSources)) {
        const group = use(source);
        const termKey = `${termDto.termId}:${termDto.termRevisionId}`;
        if (!group.directTermKeys.has(termKey)) {
          group.directTermKeys.add(termKey);
          group.dto.viaDirectTerms.push(termDto);
        }
      }
    }

    for (const recipe of commonInput.recipes) {
      const recipeDto = recipeByUseId.get(recipe.useId) ?? this.recipeUse(recipe);
      const addRecipe = (source: PromptPackSourceReferenceDto, sourceKind: 'RECIPE' | 'NESTED_TERM') => {
        const group = use(source);
        const recipeKey = `${recipeDto.useId}:${recipeDto.paletteRevisionId}`;
        let recipeUse = group.recipeByKey.get(recipeKey);
        if (!recipeUse) {
          recipeUse = { ...recipeDto, sourceKinds: [] };
          group.recipeByKey.set(recipeKey, recipeUse);
          group.dto.viaRecipes.push(recipeUse);
        }
        if (!recipeUse.sourceKinds.includes(sourceKind)) recipeUse.sourceKinds.push(sourceKind);
      };
      for (const source of packSources(recipe.packSources)) addRecipe(source, 'RECIPE');
      for (const nestedTerm of recipe.terms) {
        for (const source of packSources(nestedTerm.packSources)) addRecipe(source, 'NESTED_TERM');
      }
      for (const reference of recipe.references) {
        for (const source of packSources(reference.packSources)) {
          const group = use(source);
          const referenceKey = `${reference.assetId}:${reference.role}:${recipe.useId}`;
          if (!group.referenceKeys.has(referenceKey)) {
            group.referenceKeys.add(referenceKey);
            group.dto.viaReferences.push({
              assetId: reference.assetId,
              role: reference.role,
              recipeUseId: recipe.useId,
            });
          }
        }
      }
    }

    for (const reference of commonInput.directReferences) {
      for (const source of packSources(reference.packSources)) {
        const group = use(source);
        const referenceKey = `${reference.assetId}:${reference.role}:direct`;
        if (!group.referenceKeys.has(referenceKey)) {
          group.referenceKeys.add(referenceKey);
          group.dto.viaReferences.push({
            assetId: reference.assetId,
            role: reference.role,
            recipeUseId: null,
          });
        }
      }
    }

    return [...grouped.values()].map((group) => group.dto);
  }

  private termUse(termId: string, termRevisionId: string): AssetRelationshipTermUseDto {
    const row = this.db
      .prepare(
        `SELECT revision.title, revision.title_locale FROM term_revisions revision
      WHERE id = ? AND term_id = ?`,
      )
      .get(termRevisionId, termId) as JsonMap | undefined;
    const localizations = this.db
      .prepare(
        `SELECT locale, title FROM term_localizations
        WHERE term_revision_id = ? ORDER BY locale, id`,
      )
      .all(termRevisionId) as JsonMap[];
    return {
      termId,
      termRevisionId,
      title: text(row?.title) || termId,
      titleLocale: text(row?.title_locale),
      localizations: localizations.map((localization) => ({
        locale: text(localization.locale),
        title: text(localization.title),
      })),
    };
  }

  private recipeUse(recipe: PromptCommonInputDto['recipes'][number]): AssetRelationshipRecipeUseDto {
    return {
      useId: recipe.useId,
      paletteId: recipe.paletteId,
      paletteRevisionId: recipe.paletteRevisionId,
      name: recipe.name || recipe.paletteId,
      nameLocale: recipe.nameLocale,
      localizations: recipe.localizations.map((item) => ({ ...item })),
      parameterValues: { ...recipe.parameterValues },
    };
  }

  private packSourceRecord(source: PromptPackSourceReferenceDto): {
    pack: AssetRelationshipPackIdentityDto;
    releaseItem: AssetRelationshipPackReleaseItemDto;
  } {
    const row = this.db
      .prepare(
        `SELECT pack.id AS pack_id, pack.display_name,
        release.id AS release_id, release.version AS release_version,
        item.id AS release_item_id, item.item_key, item.object_type, item.object_revision_id
      FROM packs pack
      JOIN pack_releases release ON release.pack_id = pack.id
      JOIN pack_release_items item ON item.release_id = release.id
      WHERE pack.id = ? AND release.id = ? AND item.id = ?`,
      )
      .get(source.packId, source.packReleaseId, source.packReleaseItemId) as JsonMap | undefined;
    if (!row) {
      return {
        pack: {
          packId: source.packId,
          packDisplayName: source.packId,
          packReleaseId: source.packReleaseId,
          packReleaseVersion: source.packReleaseId,
        },
        releaseItem: {
          id: source.packReleaseItemId,
          itemKey: source.packReleaseItemId,
          objectType: '',
          objectRevisionId: '',
        },
      };
    }
    return { pack: this.packIdentityFromRow(row), releaseItem: this.releaseItemFromRow(row) };
  }

  private packIdentityFromRow(row: JsonMap): AssetRelationshipPackIdentityDto {
    return {
      packId: text(row.pack_id),
      packDisplayName: text(row.display_name),
      packReleaseId: text(row.release_id),
      packReleaseVersion: text(row.release_version),
    };
  }

  private releaseItemFromRow(row: JsonMap): AssetRelationshipPackReleaseItemDto {
    return {
      id: text(row.release_item_id),
      itemKey: text(row.item_key),
      objectType: text(row.object_type),
      objectRevisionId: text(row.object_revision_id),
    };
  }
}
