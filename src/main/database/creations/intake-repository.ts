import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type {
  AssetDto,
  AlbumCreationDefaultsDto,
  CreationDraftDto,
  CreationDraftSaveInput,
  CreationDraftStartInput,
  CreationDictionaryScopeDto,
  CreatorPromptNodeInput,
  FavoriteAddResult,
  FavoriteTextMaterialDto,
  GenerationTargetInput,
  ImportedCreationOutputDto,
  ImportedImageMetadataInput,
  IntakeCommitInput,
  IntakeCommitResult,
  MaterialSelectionTargetInput,
  WordPaletteReferenceInput,
} from '@/shared/contracts';
import type { LibraryStorage, StoredObject } from '@/main/database/core/storage';
import { emptyCreationDictionaryScope } from '@/shared/album-creation-defaults';
import { type JsonMap, mediaUrl, now, text } from '@/main/database/core/values';
import type { CreationImportRepository } from '@/main/database/creations/creation-import-repository';
import {
  defaultImportedImageMetadata,
  writeImportedMaterialMetadata,
} from '@/main/database/assets/external-material-import-metadata';
import {
  creationDraftReferenceAssetIds,
  normalizeCreationDraftSave,
  storedCreationDraftMatches,
} from '@/main/database/creations/creation-draft-save';
import { imageDimensions } from '@/main/media/image-dimensions';

const maxImageHeaderBytes = 4 * 1024 * 1024;

const extensionByMimeType = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
} as const;

interface StagedMedia {
  stored: StoredObject;
  mimeType: keyof typeof extensionByMimeType;
}

function hasExpectedMediaSignature(bytes: Uint8Array, mimeType: keyof typeof extensionByMimeType) {
  const header = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, 12));
  if (mimeType === 'image/png') {
    return header.length >= 8 && header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
  }
  if (mimeType === 'image/jpeg') {
    return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  }
  if (mimeType === 'image/gif') {
    const signature = header.subarray(0, 6).toString('ascii');
    return header.length >= 10 && (signature === 'GIF87a' || signature === 'GIF89a');
  }
  if (mimeType === 'image/webp') {
    return (
      header.length >= 12 &&
      header.subarray(0, 4).toString('ascii') === 'RIFF' &&
      header.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  if (mimeType === 'image/svg+xml') {
    return (
      imageDimensions(
        Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.byteLength, maxImageHeaderBytes)),
        '.svg',
      ) !== null
    );
  }
  if (mimeType === 'video/webm') {
    return header.length >= 4 && header.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex'));
  }
  return header.length >= 12 && header.subarray(4, 8).toString('ascii') === 'ftyp';
}

async function waitForE2eCommitDelay() {
  if (process.env.AIY_E2E !== '1') return;
  const requested = Number(process.env.AIY_E2E_INTAKE_COMMIT_DELAY_MS ?? 0);
  if (!Number.isFinite(requested) || requested <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, Math.min(10_000, Math.trunc(requested))));
}

export class IntakeRepository {
  constructor(
    private readonly storage: LibraryStorage,
    private readonly creationImports: CreationImportRepository,
  ) {}

  private get db() {
    return this.storage.db;
  }

  async commit(input: IntakeCommitInput): Promise<IntakeCommitResult> {
    if (!input.items.length) throw new Error('Nothing to import');
    // A deterministic, event-loop-friendly pending window lets E2E prove that
    // the gallery remains usable while this IPC request is unresolved.
    await waitForE2eCommitDelay();
    const stagedMedia = new Map<string, StagedMedia>();
    // Staged one at a time: the object-store writes yield between images so a
    // large batch never blocks window paint or other IPC.
    for (const item of input.items) {
      if (item.kind === 'TEXT') continue;
      if (!hasExpectedMediaSignature(item.bytes, item.mimeType)) {
        throw new Error(`Media type does not match file content: ${item.name}`);
      }
      const stored = await this.storage.storeBufferAsync(item.bytes, extensionByMimeType[item.mimeType]);
      stagedMedia.set(item.id, {
        stored: {
          ...stored,
          width: item.width || stored.width,
          height: item.height || stored.height,
        },
        mimeType: item.mimeType,
      });
    }
    const favorite = input.favorite === true;

    return this.db
      .transaction(() => {
        const materialIds: string[] = [];
        const imageMaterialIds: string[] = [];
        const videoMaterialIds: string[] = [];
        const linkedOutputs: ImportedCreationOutputDto[] = [];
        const relationshipBatchId = ulid();
        const seenMaterialIds = new Set<string>();
        const seenTextValues = new Set<string>();
        const textValues: string[] = [];
        for (const item of input.items) {
          if (item.kind === 'TEXT') {
            const value = item.text.trim();
            if (!value) continue;
            if (!seenTextValues.has(value)) {
              seenTextValues.add(value);
              textValues.push(value);
            }
            // Creation text is an editable PromptDraft fact, not a reusable
            // material. Only a plain import turns pasted text into a durable
            // text material.
            if (input.intent === 'IMPORT') {
              const materialId = this.ensureTextMaterial(value, input.source);
              if (!seenMaterialIds.has(materialId)) {
                seenMaterialIds.add(materialId);
                materialIds.push(materialId);
              }
            }
            continue;
          }
          const staged = stagedMedia.get(item.id);
          if (!staged) throw new Error(`Media could not be staged: ${item.name}`);
          const imported = this.ensureMediaMaterial(
            staged,
            item.kind,
            input.source,
            item.name,
            item.sourceUrl ?? '',
            item.metadata,
            item.kind === 'VIDEO' ? item.durationMs : null,
          );
          const materialId = imported.materialId;
          if (seenMaterialIds.has(materialId)) continue;
          seenMaterialIds.add(materialId);
          materialIds.push(materialId);
          if (item.kind === 'IMAGE') imageMaterialIds.push(materialId);
          else videoMaterialIds.push(materialId);
          if (item.kind === 'IMAGE' && item.relationship) {
            linkedOutputs.push(
              this.creationImports.linkExistingAsset({
                batchId: relationshipBatchId,
                seriesId: item.relationship.seriesId,
                promptVersionId: item.relationship.promptVersionId,
                imageAssetId: imported.assetId,
                source: input.source,
                originalName: item.name,
                metadata: item.metadata ?? defaultImportedImageMetadata(item.name, item.sourceUrl ?? ''),
              }),
            );
          }
        }
        if (!materialIds.length && !textValues.length) throw new Error('Nothing to import');

        let favoriteCount = 0;
        if (favorite) {
          const findFavorite = this.db.prepare(
            `SELECT id FROM material_favorites
          WHERE material_id = ? AND deleted_at IS NULL`,
          );
          const insertFavorite = this.db.prepare(
            `INSERT INTO material_favorites(id, material_id, created_at, deleted_at)
          VALUES (?, ?, ?, NULL)`,
          );
          for (const materialId of materialIds) {
            const existing = findFavorite.get(materialId) as JsonMap | undefined;
            if (existing) continue;
            const favoriteId = ulid();
            insertFavorite.run(favoriteId, materialId, now());
            this.storage.recordChange('MATERIAL_FAVORITE', favoriteId, 'CREATE', { materialId });
            favoriteCount += 1;
          }
        }

        if (input.intent === 'IMPORT') {
          const albumId = input.albumId ?? null;
          return {
            intent: input.intent,
            draft: null,
            favoriteCount,
            materialIds,
            imageMaterialIds,
            videoMaterialIds,
            linkedOutputs,
            albumId,
          };
        }

        if (videoMaterialIds.length) throw new Error('Videos cannot be used as image creation references');
        const draftId = ulid();
        const createdAt = now();
        this.db
          .prepare(
            `INSERT INTO creation_drafts
        (id, text_content, created_at, updated_at, consumed_at, source_series_id, deleted_at)
        VALUES (?, ?, ?, ?, NULL, NULL, NULL)`,
          )
          .run(draftId, textValues.join('\n\n'), createdAt, createdAt);
        const insertDraftMaterial = this.db.prepare(
          `INSERT INTO creation_draft_materials
        (id, creation_draft_id, material_id, role, sort_order) VALUES (?, ?, ?, 'REFERENCE', ?)`,
        );
        for (const [sortOrder, materialId] of materialIds.entries()) {
          insertDraftMaterial.run(ulid(), draftId, materialId, sortOrder);
        }
        this.storage.recordChange('CREATION_DRAFT', draftId, 'CREATE', {
          referenceMaterialIds: materialIds,
          hasText: textValues.length > 0,
        });
        return {
          intent: input.intent,
          draft: this.getDraft(draftId),
          favoriteCount,
          materialIds,
          imageMaterialIds,
          videoMaterialIds,
          linkedOutputs,
          albumId: null,
        };
      })
      .immediate();
  }

  latestDraft(): CreationDraftDto | null {
    const row = this.db
      .prepare(
        `SELECT id FROM creation_drafts
      WHERE consumed_at IS NULL AND deleted_at IS NULL
      ORDER BY updated_at DESC, id DESC LIMIT 1`,
      )
      .get() as JsonMap | undefined;
    return row ? this.getDraft(text(row.id)) : null;
  }

  startDraft(input: CreationDraftStartInput, defaults: AlbumCreationDefaultsDto): CreationDraftDto {
    return this.db
      .transaction(() => {
        if (input.albumId) {
          const album = this.db
            .prepare(
              `SELECT archived_at FROM albums
          WHERE id = ? AND deleted_at IS NULL`,
            )
            .get(input.albumId) as JsonMap | undefined;
          if (!album) throw new Error('Album not found');
          if (album.archived_at) throw new Error('Archived albums cannot start a new creation');
        }
        const existing = this.db
          .prepare(
            `SELECT id FROM creation_drafts
        WHERE target_album_id IS ? AND consumed_at IS NULL AND deleted_at IS NULL
        ORDER BY updated_at DESC, id DESC LIMIT 1`,
          )
          .get(input.albumId) as JsonMap | undefined;
        if (existing) return this.getDraft(text(existing.id));
        for (const reference of defaults.recipes) {
          if (
            !this.db
              .prepare(
                `SELECT 1 FROM word_palettes palette
          JOIN word_palette_revisions revision ON revision.palette_id = palette.id
          WHERE palette.id = ? AND revision.id = ?
            AND palette.archived_at IS NULL AND palette.deleted_at IS NULL`,
              )
              .get(reference.paletteId, reference.paletteRevisionId)
          ) {
            throw new Error('A default recipe is unavailable');
          }
        }
        const draft = this.saveDraft({
          id: null,
          targetAlbumId: input.albumId,
          title: '',
          text: '',
          referenceAssetIds: [],
          termPromptLocale: input.termPromptLocale,
          termIds: [],
          wordPaletteReferences: defaults.recipes,
          dictionaryScope: defaults.dictionaryScope,
          canvasPresetKey: null,
          quality: 'low',
          selectedModelKeys: [],
          repeatCount: 1,
          modelTargets: [],
        });
        const appliedAt = now();
        this.db.prepare('UPDATE creation_drafts SET defaults_applied_at = ? WHERE id = ?').run(appliedAt, draft.id);
        this.storage.recordChange('CREATION_DRAFT', draft.id, 'APPLY_ALBUM_DEFAULTS', {
          albumId: input.albumId,
          recipeCount: defaults.recipes.length,
          dictionaryMode: defaults.dictionaryScope.mode,
        });
        return this.getDraft(draft.id);
      })
      .immediate();
  }

  saveDraft(input: CreationDraftSaveInput): CreationDraftDto {
    return this.db
      .transaction(() => {
        const existing = input.id
          ? (this.db
              .prepare(
                `SELECT * FROM creation_drafts
        WHERE id = ? AND consumed_at IS NULL AND deleted_at IS NULL`,
              )
              .get(input.id) as JsonMap | undefined)
          : undefined;
        const targetAlbumId =
          input.targetAlbumId === undefined
            ? existing?.target_album_id
              ? text(existing.target_album_id)
              : null
            : input.targetAlbumId;
        const dictionaryScope =
          input.dictionaryScope ?? (existing ? this.dictionaryScope(existing) : emptyCreationDictionaryScope());
        if (targetAlbumId) {
          const album = this.db
            .prepare(
              `SELECT archived_at FROM albums
          WHERE id = ? AND deleted_at IS NULL`,
            )
            .get(targetAlbumId) as JsonMap | undefined;
          if (!album) throw new Error('Album not found');
          if (album.archived_at) throw new Error('Archived albums cannot receive a creation');
        }
        const draftId = existing ? text(existing.id) : ulid();
        const modelTargets = this.normalizeModelTargets(input);
        const normalized = normalizeCreationDraftSave(input, targetAlbumId, dictionaryScope, modelTargets);
        if (existing) {
          const storedReferenceAssetIds = creationDraftReferenceAssetIds(this.db, draftId);
          if (storedCreationDraftMatches(existing, normalized, storedReferenceAssetIds)) return this.getDraft(draftId);
        }

        const savedAt = now();
        const values = [
          normalized.targetAlbumId,
          normalized.text,
          normalized.title,
          normalized.termPromptLocale,
          normalized.termIdsJson,
          normalized.paletteReferencesJson,
          normalized.promptNodesJson,
          normalized.dictionaryScopeMode,
          normalized.dictionarySourcesJson,
          normalized.dictionaryIncludesLocalTerms ? 1 : 0,
          normalized.canvasPresetKey,
          normalized.quality,
          normalized.selectedModelKeysJson,
          normalized.repeatCount,
          normalized.modelTargetsJson,
          savedAt,
        ] as const;
        if (existing) {
          this.db
            .prepare(
              `UPDATE creation_drafts SET target_album_id = ?, text_content = ?, title = ?,
          term_prompt_locale = ?, term_ids_json = ?, palette_references_json = ?, prompt_nodes_json = ?,
          dictionary_scope_mode = ?, dictionary_pack_sources_json = ?, dictionary_include_local_terms = ?, canvas_preset_key = ?,
          quality = ?, selected_model_keys_json = ?, repeat_count = ?, model_targets_json = ?, updated_at = ? WHERE id = ?`,
            )
            .run(...values, draftId);
        } else {
          this.db
            .prepare(
              `INSERT INTO creation_drafts
          (id, title, text_content, created_at, updated_at, consumed_at, source_series_id, deleted_at,
            term_prompt_locale, term_ids_json, palette_references_json, prompt_nodes_json,
            canvas_preset_key, quality, selected_model_keys_json, repeat_count, model_targets_json,
            target_album_id, dictionary_scope_mode, dictionary_pack_sources_json, dictionary_include_local_terms)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              draftId,
              normalized.title,
              normalized.text,
              savedAt,
              savedAt,
              normalized.termPromptLocale,
              normalized.termIdsJson,
              normalized.paletteReferencesJson,
              normalized.promptNodesJson,
              normalized.canvasPresetKey,
              normalized.quality,
              normalized.selectedModelKeysJson,
              normalized.repeatCount,
              normalized.modelTargetsJson,
              normalized.targetAlbumId,
              normalized.dictionaryScopeMode,
              normalized.dictionarySourcesJson,
              normalized.dictionaryIncludesLocalTerms ? 1 : 0,
            );
        }

        this.db.prepare('DELETE FROM creation_draft_materials WHERE creation_draft_id = ?').run(draftId);
        for (const [sortOrder, assetId] of normalized.referenceAssetIds.entries()) {
          const materialId = this.ensureMaterialForAsset(assetId);
          this.db
            .prepare(
              `INSERT INTO creation_draft_materials
          (id, creation_draft_id, material_id, role, sort_order) VALUES (?, ?, ?, 'REFERENCE', ?)`,
            )
            .run(ulid(), draftId, materialId, sortOrder);
        }
        this.storage.recordChange('CREATION_DRAFT', draftId, existing ? 'UPDATE' : 'CREATE', {});
        return this.getDraft(draftId);
      })
      .immediate();
  }

  listFavoriteTexts(): FavoriteTextMaterialDto[] {
    return (
      this.db
        .prepare(
          `SELECT material.id, material.text_content, material.created_at,
        favorite.created_at AS favorited_at
      FROM material_favorites favorite
      JOIN materials material ON material.id = favorite.material_id
      WHERE favorite.deleted_at IS NULL AND material.deleted_at IS NULL AND material.kind = 'TEXT'
      ORDER BY favorite.created_at DESC, favorite.id DESC`,
        )
        .all() as JsonMap[]
    ).map((row) => ({
      id: text(row.id),
      text: text(row.text_content),
      createdAt: text(row.created_at),
      favoritedAt: text(row.favorited_at),
    }));
  }

  addFavorite(target: MaterialSelectionTargetInput): FavoriteAddResult {
    return this.db.transaction(() => {
      const materialId =
        target.kind === 'IMAGE_ASSET' ? this.ensureMaterialForAsset(target.imageAssetId) : target.materialId;
      const material = this.db
        .prepare('SELECT id FROM materials WHERE id = ? AND deleted_at IS NULL')
        .get(materialId) as JsonMap | undefined;
      if (!material) throw new Error('Material not found');
      const existing = this.db
        .prepare(
          `SELECT id, created_at FROM material_favorites
        WHERE material_id = ? AND deleted_at IS NULL`,
        )
        .get(materialId) as JsonMap | undefined;
      if (existing) return { materialId, createdAt: text(existing.created_at), created: false };

      const favoriteId = ulid();
      const createdAt = now();
      this.db
        .prepare(
          `INSERT INTO material_favorites(id, material_id, created_at, deleted_at)
        VALUES (?, ?, ?, NULL)`,
        )
        .run(favoriteId, materialId, createdAt);
      this.storage.recordChange('MATERIAL_FAVORITE', favoriteId, 'CREATE', { materialId });
      return { materialId, createdAt, created: true };
    })();
  }

  removeFavorite(materialId: string): boolean {
    return this.db.transaction(() => {
      const favorite = this.db
        .prepare(
          `SELECT id FROM material_favorites
        WHERE material_id = ? AND deleted_at IS NULL`,
        )
        .get(materialId) as JsonMap | undefined;
      if (!favorite) return false;

      const favoriteId = text(favorite.id);
      const deletedAt = now();
      this.db.prepare('UPDATE material_favorites SET deleted_at = ? WHERE id = ?').run(deletedAt, favoriteId);
      this.db
        .prepare("INSERT INTO tombstones VALUES (?, 'MATERIAL_FAVORITE', ?, ?, 'LOCAL_ONLY')")
        .run(ulid(), favoriteId, deletedAt);
      this.storage.recordChange('MATERIAL_FAVORITE', favoriteId, 'DELETE', { materialId });
      return true;
    })();
  }

  isLibraryEmpty() {
    const row = this.db
      .prepare(
        `SELECT
      EXISTS(SELECT 1 FROM materials WHERE deleted_at IS NULL) OR
      EXISTS(SELECT 1 FROM creation_drafts WHERE deleted_at IS NULL) OR
      EXISTS(SELECT 1 FROM prompt_series WHERE deleted_at IS NULL) OR
      EXISTS(SELECT 1 FROM albums WHERE deleted_at IS NULL) OR
      EXISTS(SELECT 1 FROM terms) OR
      EXISTS(SELECT 1 FROM word_palettes WHERE deleted_at IS NULL) AS has_content`,
      )
      .get() as JsonMap;
    return !Boolean(row.has_content);
  }

  private ensureTextMaterial(value: string, source: IntakeCommitInput['source']) {
    const contentHash = createHash('sha256').update(value, 'utf8').digest('hex');
    const existing = this.db
      .prepare(
        `SELECT id FROM materials
      WHERE kind = 'TEXT' AND content_hash = ? AND text_content = ? AND deleted_at IS NULL
      ORDER BY created_at LIMIT 1`,
      )
      .get(contentHash, value) as JsonMap | undefined;
    if (existing) return text(existing.id);
    const materialId = ulid();
    this.db
      .prepare(
        `INSERT INTO materials
      (id, kind, image_asset_id, text_content, content_hash, source_type, created_at, deleted_at)
      VALUES (?, 'TEXT', NULL, ?, ?, ?, ?, NULL)`,
      )
      .run(materialId, value, contentHash, source, now());
    this.storage.recordChange('MATERIAL', materialId, 'CREATE', { kind: 'TEXT', source });
    return materialId;
  }

  private ensureMediaMaterial(
    staged: StagedMedia,
    mediaKind: 'IMAGE' | 'VIDEO',
    source: IntakeCommitInput['source'],
    originalName: string,
    sourceUrl: string,
    metadata?: ImportedImageMetadataInput,
    durationMs: number | null = null,
  ) {
    const existingAsset = this.db
      .prepare(
        `SELECT id FROM image_assets
      WHERE object_hash = ? AND mime_type = ? AND deleted_at IS NULL ORDER BY created_at LIMIT 1`,
      )
      .get(staged.stored.hash, staged.mimeType) as JsonMap | undefined;
    const assetId = existingAsset ? text(existingAsset.id) : ulid();
    if (!existingAsset) {
      this.db
        .prepare(
          `INSERT INTO image_assets
        (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
        VALUES (?, 'REFERENCE', ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        )
        .run(
          assetId,
          source,
          staged.stored.hash,
          staged.stored.relativePath,
          staged.stored.width,
          staged.stored.height,
          staged.mimeType,
          staged.stored.byteSize,
          now(),
        );
      this.storage.recordChange(mediaKind === 'VIDEO' ? 'VIDEO_ASSET' : 'IMAGE_ASSET', assetId, 'IMPORT', { source });
    }
    if (mediaKind === 'VIDEO') {
      if (!Number.isSafeInteger(durationMs) || (durationMs ?? 0) <= 0) throw new Error('Video duration is invalid');
      this.db
        .prepare(
          `INSERT INTO video_assets(
            image_asset_id, duration_ms, audio_status, audio_track_count,
            audio_primary_codec, audio_detected_at, audio_error_code, created_at
          )
          VALUES (?, ?, 'DETECTION_FAILED', 0, NULL, NULL, 'NOT_PROBED', ?)
          ON CONFLICT(image_asset_id) DO NOTHING`,
        )
        .run(assetId, durationMs, now());
    }
    const existingMaterial = this.db
      .prepare(
        `SELECT id FROM materials
      WHERE kind = ? AND image_asset_id = ? AND deleted_at IS NULL`,
      )
      .get(mediaKind, assetId) as JsonMap | undefined;
    const materialId = existingMaterial ? text(existingMaterial.id) : ulid();
    if (!existingMaterial) {
      this.db
        .prepare(
          `INSERT INTO materials
        (id, kind, image_asset_id, text_content, content_hash, source_type, created_at, deleted_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, NULL)`,
        )
        .run(materialId, mediaKind, assetId, staged.stored.hash, source, now());
      this.storage.recordChange('MATERIAL', materialId, 'CREATE', { kind: mediaKind, assetId, source });
    }
    writeImportedMaterialMetadata(this.storage, { materialId, originalName, sourceUrl, metadata });
    return { materialId, assetId };
  }

  private ensureMaterialForAsset(assetId: string) {
    const asset = this.db
      .prepare(
        `SELECT object_hash, origin_type FROM image_assets
      WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(assetId) as JsonMap | undefined;
    if (!asset) throw new Error('Reference image not found');
    const existing = this.db
      .prepare(
        `SELECT id FROM materials
      WHERE image_asset_id = ? AND deleted_at IS NULL`,
      )
      .get(assetId) as JsonMap | undefined;
    if (existing) return text(existing.id);
    const materialId = ulid();
    this.db
      .prepare(
        `INSERT INTO materials
      (id, kind, image_asset_id, text_content, content_hash, source_type, created_at, deleted_at)
      VALUES (?, 'IMAGE', ?, NULL, ?, ?, ?, NULL)`,
      )
      .run(materialId, assetId, text(asset.object_hash), text(asset.origin_type), now());
    this.storage.recordChange('MATERIAL', materialId, 'CREATE', { kind: 'IMAGE', assetId });
    return materialId;
  }

  private getDraft(draftId: string): CreationDraftDto {
    const draft = this.db
      .prepare(
        `SELECT * FROM creation_drafts
      WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(draftId) as JsonMap | undefined;
    if (!draft) throw new Error('Creation draft not found');
    const referenceAssets = (
      this.db
        .prepare(
          `SELECT asset.* FROM creation_draft_materials link
      JOIN materials material ON material.id = link.material_id
      JOIN image_assets asset ON asset.id = material.image_asset_id
      WHERE link.creation_draft_id = ? AND material.kind = 'IMAGE'
        AND material.deleted_at IS NULL AND asset.deleted_at IS NULL
      ORDER BY link.sort_order`,
        )
        .all(draftId) as JsonMap[]
    ).map((row) => this.assetDto(row));
    const quality = ['low', 'medium', 'high'].includes(text(draft.quality))
      ? (text(draft.quality) as CreationDraftDto['quality'])
      : 'low';
    const selectedModelKeys = this.stringArray(draft.selected_model_keys_json);
    const repeatCount = Math.max(1, Number(draft.repeat_count) || 1);
    const storedModelTargets = this.modelTargets(draft.model_targets_json);
    const title = text(draft.title);
    return {
      id: draftId,
      targetAlbumId: draft.target_album_id ? text(draft.target_album_id) : null,
      title: title,
      text: text(draft.text_content),
      ...(this.promptNodes(draft.prompt_nodes_json).length
        ? { promptNodes: this.promptNodes(draft.prompt_nodes_json) }
        : {}),
      referenceAssets,
      termPromptLocale: text(draft.term_prompt_locale) === 'zh' ? 'zh' : 'en',
      termIds: this.stringArray(draft.term_ids_json),
      wordPaletteReferences: this.paletteReferences(draft.palette_references_json),
      dictionaryScope: this.dictionaryScope(draft),
      canvasPresetKey: text(draft.canvas_preset_key) || null,
      quality,
      selectedModelKeys,
      repeatCount,
      modelTargets: storedModelTargets.length
        ? storedModelTargets
        : selectedModelKeys.map((modelKey) => ({ modelKey, count: repeatCount, quality })),
      createdAt: text(draft.created_at),
      updatedAt: text(draft.updated_at),
    };
  }

  private dictionaryScope(draft: JsonMap): CreationDictionaryScopeDto {
    let sources: CreationDictionaryScopeDto['sources'] = [];
    try {
      const parsed = JSON.parse(text(draft.dictionary_pack_sources_json));
      if (Array.isArray(parsed)) {
        sources = parsed.flatMap((item): CreationDictionaryScopeDto['sources'] => {
          if (!item || typeof item !== 'object') return [];
          const source = item as Record<string, unknown>;
          return typeof source.packId === 'string' && typeof source.packReleaseId === 'string'
            ? [{ packId: source.packId, packReleaseId: source.packReleaseId }]
            : [];
        });
      }
    } catch {
      sources = [];
    }
    return {
      mode: text(draft.dictionary_scope_mode) === 'SELECTED' ? 'SELECTED' : 'ALL',
      sources,
      includeLocalTerms:
        draft.dictionary_include_local_terms === undefined ? true : Boolean(draft.dictionary_include_local_terms),
    };
  }

  private stringArray(value: unknown): string[] {
    try {
      const parsed = JSON.parse(text(value));
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  }

  private modelTargets(value: unknown): GenerationTargetInput[] {
    try {
      const parsed = JSON.parse(text(value));
      if (!Array.isArray(parsed)) return [];
      const seen = new Set<string>();
      return parsed.flatMap((item): GenerationTargetInput[] => {
        if (!item || typeof item !== 'object') return [];
        const candidate = item as Record<string, unknown>;
        if (typeof candidate.modelKey !== 'string' || seen.has(candidate.modelKey)) return [];
        if (!['low', 'medium', 'high'].includes(String(candidate.quality))) return [];
        const count = Math.min(100, Math.max(1, Math.trunc(Number(candidate.count) || 1)));
        seen.add(candidate.modelKey);
        return [
          { modelKey: candidate.modelKey, count, quality: candidate.quality as GenerationTargetInput['quality'] },
        ];
      });
    } catch {
      return [];
    }
  }

  private promptNodes(value: unknown): CreatorPromptNodeInput[] {
    try {
      const parsed = JSON.parse(text(value));
      if (!Array.isArray(parsed)) return [];
      const seenTerms = new Set<string>();
      const seenPalettes = new Set<string>();
      return parsed.flatMap((item): CreatorPromptNodeInput[] => {
        if (!item || typeof item !== 'object') return [];
        const node = item as Record<string, unknown>;
        if (node.kind === 'TEXT' && typeof node.text === 'string') return [{ kind: 'TEXT', text: node.text }];
        if (node.kind === 'TERM' && typeof node.termId === 'string' && !seenTerms.has(node.termId)) {
          seenTerms.add(node.termId);
          return [
            {
              kind: 'TERM',
              termId: node.termId,
              ...(node.promptLocale === 'zh' || node.promptLocale === 'en' ? { promptLocale: node.promptLocale } : {}),
            },
          ];
        }
        if (node.kind === 'RECIPE' && typeof node.paletteId === 'string' && !seenPalettes.has(node.paletteId)) {
          seenPalettes.add(node.paletteId);
          return [{ kind: 'RECIPE', paletteId: node.paletteId }];
        }
        return [];
      });
    } catch {
      return [];
    }
  }

  private normalizeModelTargets(input: CreationDraftSaveInput): GenerationTargetInput[] {
    const provided = input.modelTargets?.length
      ? input.modelTargets
      : [...new Set(input.selectedModelKeys)].map((modelKey) => ({
          modelKey,
          count: input.repeatCount,
          quality: input.quality,
        }));
    return this.modelTargets(JSON.stringify(provided));
  }

  private paletteReferences(value: unknown): WordPaletteReferenceInput[] {
    try {
      const parsed = JSON.parse(text(value));
      return Array.isArray(parsed)
        ? parsed.filter((item): item is WordPaletteReferenceInput =>
            Boolean(
              item &&
              typeof item === 'object' &&
              typeof item.paletteId === 'string' &&
              typeof item.paletteRevisionId === 'string' &&
              (item.promptLocale === 'zh' || item.promptLocale === 'en') &&
              item.parameterValues &&
              typeof item.parameterValues === 'object',
            ),
          )
        : [];
    } catch {
      return [];
    }
  }

  private assetDto(row: JsonMap): AssetDto {
    return {
      id: text(row.id),
      kind: text(row.kind) as AssetDto['kind'],
      originType: text(row.origin_type),
      width: Number(row.width),
      height: Number(row.height),
      mimeType: text(row.mime_type),
      byteSize: Number(row.byte_size),
      mediaUrl: mediaUrl(text(row.id)),
      createdAt: text(row.created_at),
    };
  }
}
