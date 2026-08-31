import { stat } from 'node:fs/promises';
import path from 'node:path';
import { ulid } from 'ulid';
import type { AssetDto, GenerationInput, PromptCommonInputDto } from '@/shared/contracts';
import { databaseBatches, sqlPlaceholders } from '@/main/database/core/database-batch';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import { rehomeCreationInputStashes } from '@/main/database/creations/creation-input-stash-repository';
import { rehomeIdeaCreation } from '@/main/database/creations/idea-creation-lifecycle';
import { CreationItemRepository } from '@/main/database/creations/creation-item-repository';
import { WorkbenchReader } from '@/main/database/generation/workbench-reader';
import {
  type GenerationComposition,
  type PreparedPaletteBinding,
  normalizedGenerationComposition,
  pushMapped,
  samePromptInputAcrossTextComposerUpgrade,
} from '@/main/database/generation/workbench-values';

export class WorkbenchPreparationRepository extends WorkbenchReader {
  importReference(sourcePath: string): AssetDto {
    const imported = this.storage.copyIntoObjectStore(sourcePath);
    return this.commitImportedReference(sourcePath, imported);
  }

  async importReferenceAsync(sourcePath: string): Promise<AssetDto> {
    const source = await stat(sourcePath);
    if (!source.isFile() || source.size <= 0 || source.size > 25 * 1024 * 1024) {
      throw new Error('Reference image must be 25 MB or smaller');
    }
    const imported = await this.storage.copyIntoObjectStoreAsync(sourcePath);
    return this.commitImportedReference(sourcePath, imported);
  }

  async importReferenceBytes(sourceName: string, bytes: Uint8Array): Promise<AssetDto> {
    const extension = path.extname(sourceName).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension) || bytes.byteLength < 1) {
      throw new Error('Reference image bytes are invalid');
    }
    const imported = await this.storage.storeBufferAsync(bytes, extension);
    return this.commitImportedReference(sourceName, imported);
  }

  private commitImportedReference(
    sourcePath: string,
    imported: ReturnType<LibraryStorage['copyIntoObjectStore']>,
  ): AssetDto {
    const existing = this.db
      .prepare('SELECT id FROM image_assets WHERE object_hash = ? AND deleted_at IS NULL')
      .get(imported.hash) as JsonMap | undefined;
    if (existing) return this.assetDto(text(existing.id))!;
    const id = ulid();
    const extension = path.extname(sourcePath).toLowerCase();
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
    this.db
      .prepare(
        `INSERT INTO image_assets
        (id, kind, origin_type, object_hash, relative_path, width, height, mime_type, byte_size, created_at, deleted_at)
        VALUES (?, 'REFERENCE', 'LOCAL_IMPORT', ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(id, imported.hash, imported.relativePath, imported.width, imported.height, mime, imported.byteSize, now());
    this.storage.recordChange('IMAGE_ASSET', id, 'IMPORT', { kind: 'REFERENCE' });
    return this.assetDto(id)!;
  }

  prepareGeneration(
    input: GenerationInput,
    promptInput: PromptCommonInputDto,
    options: { forceNewVersion?: boolean } = {},
  ): { runId: string; versionId: string; seriesId: string; effectiveReferenceAssetIds: string[] } {
    const prepared = this.prepareStructuredVersion(input, promptInput, true, options.forceNewVersion ?? false);
    if (!prepared.runId) throw new Error('Generation run was not created');
    return { ...prepared, runId: prepared.runId };
  }

  saveCreationDraftAsV01(
    input: GenerationInput,
    promptInput: PromptCommonInputDto,
  ): { versionId: string; seriesId: string } {
    return this.savePromptVersion(input, promptInput);
  }

  savePromptVersion(
    input: GenerationInput,
    promptInput: PromptCommonInputDto,
  ): { versionId: string; seriesId: string } {
    const prepared = this.prepareStructuredVersion(input, promptInput, false, false);
    return { versionId: prepared.versionId, seriesId: prepared.seriesId };
  }

  createPromptVersion(
    input: GenerationInput,
    promptInput: PromptCommonInputDto,
  ): { versionId: string; seriesId: string } {
    const prepared = this.prepareStructuredVersion(input, promptInput, false, true, true);
    return { versionId: prepared.versionId, seriesId: prepared.seriesId };
  }

  private prepareStructuredVersion(
    input: GenerationInput,
    promptInput: PromptCommonInputDto,
    createRun: boolean,
    forceNewVersion: boolean,
    allowEmptyPrompt = false,
  ): { runId: string | null; versionId: string; seriesId: string; effectiveReferenceAssetIds: string[] } {
    if (!allowEmptyPrompt && !input.prompt.trim()) throw new Error('Prompt is empty');
    const composition = {
      ...normalizedGenerationComposition(input),
      termPromptLocale: promptInput.directTermPromptLocale,
    };
    const sourceAssetId = input.sourceAssetId?.trim() || null;
    if (sourceAssetId && !composition.referenceAssetIds.includes(sourceAssetId)) {
      throw new Error('An image edit source must also be attached as a reference');
    }
    if (sourceAssetId && !this.getAssetPath(sourceAssetId)) {
      throw new Error('Image edit source is unavailable');
    }
    const contentHash = this.executionSnapshots.promptInputHash(promptInput);
    return this.db
      .transaction(() => {
        const { seriesId, current } = this.resolveStructuredSeries(input);
        const sourceImportId = this.resolveSourceImportId(input, seriesId);
        const { versionId, versionCreated } = this.resolveStructuredPromptVersion({
          input,
          promptInput,
          composition,
          sourceAssetId,
          sourceImportId,
          contentHash,
          seriesId,
          current,
          forceNewVersion,
        });
        const effectiveReferenceAssetIds = this.bindStructuredComposition(versionId, versionCreated, composition);
        const runId = this.createStructuredGenerationRun(input, versionId, createRun);
        if (input.creationDraftId) this.consumeCreationDraft(input.creationDraftId, seriesId, runId);
        if (runId)
          this.storage.recordChange('GENERATION_RUN', runId, 'CREATE', {
            seriesId,
            versionId,
            modelKey: input.modelKey,
          });
        return { runId, versionId, seriesId, effectiveReferenceAssetIds };
      })
      .immediate();
  }

  private resolveStructuredSeries(input: GenerationInput): { seriesId: string; current: JsonMap | undefined } {
    if (input.seriesId) {
      const series = this.db
        .prepare('SELECT current_version_id FROM prompt_series WHERE id = ? AND deleted_at IS NULL')
        .get(input.seriesId) as JsonMap | undefined;
      if (!series) throw new Error('Prompt series not found');
      const selectedVersionId = input.baseVersionId?.trim() || (series.current_version_id as string | null);
      const current = selectedVersionId
        ? (this.db
            .prepare('SELECT * FROM prompt_versions WHERE id = ? AND series_id = ?')
            .get(selectedVersionId, input.seriesId) as JsonMap | undefined)
        : undefined;
      if (selectedVersionId && !current) throw new Error('Selected base prompt version not found');
      return { seriesId: input.seriesId, current };
    }

    if (input.baseVersionId) throw new Error('A base prompt version requires an existing series');
    if (input.sourceImportId) throw new Error('An imported Prompt source requires an existing series');

    const targetAlbumId = this.resolveCreationDraftTargetAlbum(input.creationDraftId);
    const seriesId = ulid();
    const title = input.title.trim() || '新创作';
    const titleLocale = input.titleLocale ?? 'zh';
    const createdAt = now();
    this.db
      .prepare(
        `INSERT INTO prompt_series
          (id, title, title_locale, current_version_id, created_at, deleted_at)
          VALUES (?, ?, ?, NULL, ?, NULL)`,
      )
      .run(seriesId, title, titleLocale, createdAt);
    this.storage.recordChange('PROMPT_SERIES', seriesId, 'CREATE', { title, locale: titleLocale });
    this.registerNewImageCreation(input, seriesId, targetAlbumId);
    return { seriesId, current: undefined };
  }

  private registerNewImageCreation(input: GenerationInput, seriesId: string, targetAlbumId: string | null) {
    if (input.creationDraftId) {
      const derivedVisual = this.db
        .prepare('SELECT id FROM derived_visuals WHERE creation_draft_id = ?')
        .get(input.creationDraftId) as JsonMap | undefined;
      if (derivedVisual) return;
    }

    const creationItems = new CreationItemRepository(this.storage);
    if (input.inspirationStashId && input.imageBreakdownId) {
      throw new Error('An image creation cannot have two creation-form owners');
    }
    if (input.imageBreakdownId) {
      const item = creationItems.findForEntity({ kind: 'IMAGE_BREAKDOWN', id: input.imageBreakdownId });
      if (!item) throw new Error('The source image breakdown item is unavailable');
      const sourceForm = item.forms.find(
        (form) => form.role === 'IMAGE_BREAKDOWN' && form.entity.id === input.imageBreakdownId,
      );
      if (!sourceForm) throw new Error('The source image breakdown form is unavailable');
      creationItems.addOrGetForm({
        creationItemId: item.id,
        sourceFormId: sourceForm.id,
        role: 'IMAGE_CREATION',
        entity: { kind: 'PROMPT_SERIES', id: seriesId },
        anchorKey: null,
      });
      return;
    }
    if (input.inspirationStashId) {
      const item = creationItems.findForEntity({ kind: 'INSPIRATION_STASH', id: input.inspirationStashId });
      if (!item) throw new Error('The source inspiration item is unavailable');
      creationItems.addOrGetForm({
        creationItemId: item.id,
        role: 'IMAGE_CREATION',
        entity: { kind: 'PROMPT_SERIES', id: seriesId },
        anchorKey: null,
      });
      return;
    }

    creationItems.createWithForm({
      albumId: targetAlbumId,
      form: {
        role: 'IMAGE_CREATION',
        entity: { kind: 'PROMPT_SERIES', id: seriesId },
        anchorKey: null,
      },
    });
  }

  private resolveSourceImportId(input: GenerationInput, seriesId: string): string | null {
    const sourceImportId = input.sourceImportId?.trim() || null;
    if (!sourceImportId) return null;
    const source = this.db
      .prepare(
        `SELECT id FROM creation_output_imports
          WHERE id = ? AND series_id = ? AND deleted_at IS NULL`,
      )
      .get(sourceImportId, seriesId);
    if (!source) throw new Error('Imported Prompt source not found');
    return sourceImportId;
  }

  private resolveCreationDraftTargetAlbum(creationDraftId?: string | null): string | null {
    if (!creationDraftId) return null;
    const draft = this.db
      .prepare(
        `SELECT target_album_id FROM creation_drafts
          WHERE id = ? AND consumed_at IS NULL AND deleted_at IS NULL`,
      )
      .get(creationDraftId) as JsonMap | undefined;
    if (!draft) throw new Error('Creation draft is no longer available');
    const targetAlbumId = draft.target_album_id ? text(draft.target_album_id) : null;
    if (!targetAlbumId) return null;
    const available = this.db
      .prepare(
        `WITH RECURSIVE lineage(id, archived_at) AS (
            SELECT id, archived_at FROM albums WHERE id = ? AND deleted_at IS NULL
            UNION
            SELECT parent.id, parent.archived_at
            FROM lineage child
            JOIN album_members relation
              ON relation.target_type = 'ALBUM'
              AND relation.target_id = child.id
              AND relation.deleted_at IS NULL
            JOIN albums parent ON parent.id = relation.album_id AND parent.deleted_at IS NULL
          )
          SELECT 1 FROM lineage
          WHERE NOT EXISTS (SELECT 1 FROM lineage WHERE archived_at IS NOT NULL)
          LIMIT 1`,
      )
      .get(targetAlbumId);
    if (!available) throw new Error('The target album is unavailable');
    return targetAlbumId;
  }

  private resolveStructuredPromptVersion(args: {
    input: GenerationInput;
    promptInput: PromptCommonInputDto;
    composition: GenerationComposition;
    sourceAssetId: string | null;
    sourceImportId: string | null;
    contentHash: string;
    seriesId: string;
    current: JsonMap | undefined;
    forceNewVersion: boolean;
  }): { versionId: string; versionCreated: boolean } {
    const currentIsStructured = Boolean(args.current) && text(args.current!.composition_mode) === 'STRUCTURED';
    const currentSnapshot = currentIsStructured
      ? this.executionSnapshots.getPromptInputSnapshot(text(args.current!.id))
      : null;
    if (currentIsStructured && !currentSnapshot) {
      throw new Error('Structured prompt version is missing its immutable input snapshot');
    }
    const currentHashMatches = currentIsStructured && currentSnapshot!.contentHash === args.contentHash;
    const currentInputMatches =
      currentHashMatches ||
      (currentIsStructured && samePromptInputAcrossTextComposerUpgrade(currentSnapshot!.commonInput, args.promptInput));
    const currentSourceAssetId = args.current?.source_image_id ? text(args.current.source_image_id) : null;
    const currentSourceMatches = currentIsStructured && currentSourceAssetId === args.sourceAssetId;
    const currentSourceImportId = args.current?.source_import_id ? text(args.current.source_import_id) : null;
    const currentImportMatches = currentIsStructured && currentSourceImportId === args.sourceImportId;
    const existingVersionId =
      !args.forceNewVersion && currentInputMatches && currentSourceMatches && currentImportMatches
        ? text(args.current!.id)
        : '';
    if (existingVersionId && text(args.current!.content_hash) !== currentSnapshot!.contentHash) {
      throw new Error('Prompt version hash does not match its immutable input snapshot');
    }
    if (existingVersionId) {
      if (currentHashMatches) this.executionSnapshots.freezePromptInput(existingVersionId, args.promptInput);
      return { versionId: existingVersionId, versionCreated: false };
    }

    const versionId = ulid();
    const versionNo = Number(
      this.db
        .prepare('SELECT COALESCE(MAX(version_no), 0) + 1 FROM prompt_versions WHERE series_id = ?')
        .pluck()
        .get(args.seriesId),
    );
    this.db
      .prepare(
        `INSERT INTO prompt_versions
          (id, series_id, parent_version_id, source_import_id, version_no, user_intent, final_prompt, change_summary,
           source_image_id, content_hash, created_at, composition_mode, term_prompt_locale)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'STRUCTURED', ?)`,
      )
      .run(
        versionId,
        args.seriesId,
        args.current?.id ?? null,
        args.sourceImportId,
        versionNo,
        args.input.manualPrompt,
        args.input.prompt,
        args.input.changeSummary.trim() || `V${String(versionNo).padStart(2, '0')}`,
        args.sourceAssetId,
        args.contentHash,
        now(),
        args.composition.termPromptLocale,
      );
    this.db.prepare('UPDATE prompt_series SET current_version_id = ? WHERE id = ?').run(versionId, args.seriesId);
    this.storage.recordChange('PROMPT_VERSION', versionId, 'CREATE', {
      seriesId: args.seriesId,
      versionNo,
      sourceImportId: args.sourceImportId,
      composition: args.composition,
    });
    this.executionSnapshots.freezePromptInput(versionId, args.promptInput);
    return { versionId, versionCreated: true };
  }

  private bindStructuredComposition(
    versionId: string,
    versionCreated: boolean,
    composition: GenerationComposition,
  ): string[] {
    const paletteBindings = this.preparePaletteBindings(composition.wordPaletteReferences);
    const effectiveReferenceAssetIds = [...composition.referenceAssetIds];
    const effectiveReferenceAssetSet = new Set(effectiveReferenceAssetIds);
    const insertReference = this.db.prepare(
      `INSERT INTO reference_bindings
        (id, prompt_version_id, image_asset_id, sort_order, source_type, source_palette_revision_id)
        VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertTerm = this.db.prepare(
      `INSERT OR IGNORE INTO prompt_term_bindings
        (id, prompt_version_id, term_id, sort_order) VALUES (?, ?, ?, ?)`,
    );
    const upsertPalette = this.db.prepare(
      `INSERT INTO prompt_palette_bindings
        (id, prompt_version_id, palette_id, palette_revision_id, parameter_values_json, prompt_locale, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(prompt_version_id, palette_id) DO UPDATE SET
          palette_revision_id = excluded.palette_revision_id,
          parameter_values_json = excluded.parameter_values_json, prompt_locale = excluded.prompt_locale,
          sort_order = excluded.sort_order`,
    );

    let referenceSortOrder = 0;
    for (const assetId of composition.referenceAssetIds) {
      if (versionCreated) insertReference.run(ulid(), versionId, assetId, referenceSortOrder, 'DIRECT', null);
      referenceSortOrder += 1;
    }
    for (const [termIndex, termId] of composition.termIds.entries()) {
      insertTerm.run(ulid(), versionId, termId, termIndex);
    }
    for (const [referenceIndex, binding] of paletteBindings.entries()) {
      const { reference } = binding;
      upsertPalette.run(
        ulid(),
        versionId,
        reference.paletteId,
        reference.paletteRevisionId,
        JSON.stringify(binding.normalizedValues),
        reference.promptLocale,
        referenceIndex,
      );
      for (const assetId of binding.mediaAssetIds) {
        if (!effectiveReferenceAssetSet.has(assetId)) {
          effectiveReferenceAssetSet.add(assetId);
          effectiveReferenceAssetIds.push(assetId);
        }
        if (versionCreated) {
          insertReference.run(
            ulid(),
            versionId,
            assetId,
            referenceSortOrder,
            'WORD_PALETTE',
            reference.paletteRevisionId,
          );
        }
        referenceSortOrder += 1;
      }
    }
    return effectiveReferenceAssetIds;
  }

  private preparePaletteBindings(references: GenerationComposition['wordPaletteReferences']): PreparedPaletteBinding[] {
    if (!references.length) return [];
    const revisionIds = [...new Set(references.map((reference) => reference.paletteRevisionId))];
    const paletteIdByRevision = new Map<string, string>();
    const parametersByRevision = new Map<string, JsonMap[]>();
    const optionValuesByParameter = new Map<string, Set<string>>();
    const mediaByRevision = new Map<string, string[]>();

    for (const batch of databaseBatches(revisionIds)) {
      const placeholders = sqlPlaceholders(batch.length);
      const revisionRows = this.db
        .prepare(
          `SELECT revision.id, revision.palette_id
            FROM word_palette_revisions revision
            JOIN word_palettes palette ON palette.id = revision.palette_id
            WHERE revision.id IN (${placeholders}) AND palette.archived_at IS NULL AND palette.deleted_at IS NULL`,
        )
        .all(...batch) as JsonMap[];
      for (const row of revisionRows) paletteIdByRevision.set(text(row.id), text(row.palette_id));

      const parameterRows = this.db
        .prepare(
          `SELECT id, palette_revision_id, stable_key, required
            FROM word_palette_revision_parameters
            WHERE palette_revision_id IN (${placeholders})
            ORDER BY palette_revision_id, rowid`,
        )
        .all(...batch) as JsonMap[];
      for (const row of parameterRows) pushMapped(parametersByRevision, text(row.palette_revision_id), row);

      const optionRows = this.db
        .prepare(
          `SELECT parameter.id AS parameter_id, option.value_key
            FROM word_palette_revision_parameter_options option
            JOIN word_palette_revision_parameters parameter ON parameter.id = option.parameter_revision_id
            WHERE parameter.palette_revision_id IN (${placeholders})`,
        )
        .all(...batch) as JsonMap[];
      for (const row of optionRows) {
        const parameterId = text(row.parameter_id);
        const values = optionValuesByParameter.get(parameterId) ?? new Set<string>();
        values.add(text(row.value_key));
        optionValuesByParameter.set(parameterId, values);
      }

      const mediaRows = this.db
        .prepare(
          `SELECT media.palette_revision_id, media.image_asset_id
            FROM word_palette_revision_media media
            JOIN image_assets asset ON asset.id = media.image_asset_id
            WHERE media.palette_revision_id IN (${placeholders}) AND asset.deleted_at IS NULL
            ORDER BY media.palette_revision_id, media.sort_order, media.rowid`,
        )
        .all(...batch) as JsonMap[];
      for (const row of mediaRows) {
        pushMapped(mediaByRevision, text(row.palette_revision_id), text(row.image_asset_id));
      }
    }

    return references.map((reference) => {
      if (paletteIdByRevision.get(reference.paletteRevisionId) !== reference.paletteId) {
        throw new Error('Word palette not found');
      }
      const normalizedValues: Record<string, string> = {};
      for (const parameter of parametersByRevision.get(reference.paletteRevisionId) ?? []) {
        const stableKey = text(parameter.stable_key);
        const value = reference.parameterValues[stableKey] ?? '';
        if (parameter.required && !value) throw new Error(`Missing word palette parameter: ${stableKey}`);
        if (!value) continue;
        if (!optionValuesByParameter.get(text(parameter.id))?.has(value)) {
          throw new Error(`Invalid word palette parameter: ${stableKey}`);
        }
        normalizedValues[stableKey] = value;
      }
      return {
        reference,
        normalizedValues,
        mediaAssetIds: mediaByRevision.get(reference.paletteRevisionId) ?? [],
      };
    });
  }

  private createStructuredGenerationRun(input: GenerationInput, versionId: string, createRun: boolean): string | null {
    if (!createRun) return null;
    const runId = ulid();
    this.db
      .prepare(
        `INSERT INTO generation_runs
          (id, prompt_version_id, model_key, canvas_preset_key, width, height, quality, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?)`,
      )
      .run(
        runId,
        versionId,
        input.modelKey,
        input.canvasPresetKey,
        input.width ?? 0,
        input.height ?? 0,
        input.quality,
        now(),
      );
    this.generationJobs.createForRun(runId);
    return runId;
  }

  private consumeCreationDraft(creationDraftId: string, seriesId: string, runId: string | null) {
    const consumedAt = now();
    const consumed = this.db
      .prepare(
        `UPDATE creation_drafts
          SET consumed_at = ?, source_series_id = ?, updated_at = ?
          WHERE id = ? AND consumed_at IS NULL AND deleted_at IS NULL`,
      )
      .run(consumedAt, seriesId, consumedAt, creationDraftId);
    if (!consumed.changes) throw new Error('Creation draft is no longer available');
    const linkedVisual = this.db
      .prepare(
        `UPDATE derived_visuals
          SET prompt_series_id = ?, updated_at = ?
          WHERE creation_draft_id = ? AND prompt_series_id IS NULL`,
      )
      .run(seriesId, consumedAt, creationDraftId);
    const assistantRunIds = this.readDraftScopeIds('assistant_runs', creationDraftId);
    const styleExplorationBatchIds = this.readDraftScopeIds('style_exploration_batches', creationDraftId);
    this.db
      .prepare(
        `UPDATE creator_agent_turns SET scope_kind = 'SERIES', scope_id = ?
          WHERE scope_kind = 'DRAFT' AND scope_id = ?`,
      )
      .run(seriesId, creationDraftId);
    this.rehomeDraftScope('assistant_runs', creationDraftId, seriesId, consumedAt);
    this.rehomeDraftScope('style_exploration_batches', creationDraftId, seriesId, consumedAt);
    rehomeIdeaCreation(this.storage, creationDraftId, seriesId);
    rehomeCreationInputStashes(this.storage, creationDraftId, seriesId);
    this.recordScopeRehomeChanges('ASSISTANT_RUN', assistantRunIds, creationDraftId, seriesId);
    this.recordScopeRehomeChanges('STYLE_EXPLORATION_BATCH', styleExplorationBatchIds, creationDraftId, seriesId);
    this.storage.recordChange('CREATION_DRAFT', creationDraftId, 'CONSUME', { seriesId, runId });
    if (linkedVisual.changes) {
      const visualId = this.db
        .prepare('SELECT id FROM derived_visuals WHERE creation_draft_id = ?')
        .pluck()
        .get(creationDraftId);
      if (typeof visualId === 'string') {
        this.storage.recordChange('DERIVED_VISUAL', visualId, 'ATTACH_SERIES', { seriesId, runId });
        new CreationItemRepository(this.storage).touchForEntity({ kind: 'DERIVED_VISUAL', id: visualId }, consumedAt);
      }
    }
  }

  private readDraftScopeIds(table: 'assistant_runs' | 'style_exploration_batches', creationDraftId: string): string[] {
    return (
      this.db
        .prepare(`SELECT id FROM ${table} WHERE scope_kind = 'DRAFT' AND scope_id = ?`)
        .all(creationDraftId) as JsonMap[]
    ).map((row) => text(row.id));
  }

  private rehomeDraftScope(
    table: 'assistant_runs' | 'style_exploration_batches',
    creationDraftId: string,
    seriesId: string,
    updatedAt: string,
  ) {
    this.db
      .prepare(
        `UPDATE ${table} SET scope_kind = 'SERIES', scope_id = ?, updated_at = ?
          WHERE scope_kind = 'DRAFT' AND scope_id = ?`,
      )
      .run(seriesId, updatedAt, creationDraftId);
  }

  private recordScopeRehomeChanges(
    entityType: 'ASSISTANT_RUN' | 'STYLE_EXPLORATION_BATCH',
    ids: string[],
    creationDraftId: string,
    seriesId: string,
  ) {
    for (const id of ids) {
      this.storage.recordChange(entityType, id, 'REHOME_SCOPE', {
        from: { kind: 'DRAFT', id: creationDraftId },
        to: { kind: 'SERIES', id: seriesId },
      });
    }
  }
}
