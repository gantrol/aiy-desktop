import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type {
  AddTermMediaInput,
  Locale,
  NewTermInput,
  ReorderTermMediaInput,
  TermCategoryDto,
  TermDraftInput,
  TermEditorDto,
  TermMediaItemDto,
} from '@/shared/contracts';
import { type JsonMap, now, text } from '@/main/database/core/values';
import { DictionaryPaletteRepository } from '@/main/database/dictionary/dictionary-palette-repository';
import { parsePersistedTermDraft, termDraftSchema } from '@/main/database/dictionary/term-draft-schema';

export class DictionaryRepository extends DictionaryPaletteRepository {
  getTerm(termId: string, locale: Locale): TermEditorDto {
    const row = this.db
      .prepare(
        `SELECT t.*, r.*,
        EXISTS(SELECT 1 FROM drafts d WHERE d.entity_type = 'TERM' AND d.entity_id = t.id) AS has_draft
        FROM terms t JOIN term_revisions r ON r.id = t.current_revision_id WHERE t.id = ?`,
      )
      .get(termId) as JsonMap | undefined;
    if (!row) throw new Error('Term not found');
    const media = this.listTermMedia(termId);
    const details = this.loadTermRowDetails([row], locale).get(text(row.id));
    if (!details) throw new Error(`Term projection details are missing: ${termId}`);
    const base = this.termRow(row, locale, details, { totalCount: media.length, items: media.slice(0, 3) });
    const draft = this.db
      .prepare("SELECT payload, updated_at FROM drafts WHERE entity_type = 'TERM' AND entity_id = ?")
      .get(termId) as JsonMap | undefined;
    const approved: TermDraftInput = {
      termId,
      title: base.title,
      titleLocale: base.titleLocale,
      definition: base.definition,
      aliases: base.aliases,
      localizations: base.localizations,
      classificationIds: base.classificationIds,
      primaryDirectoryClassificationId: base.primaryDirectoryClassificationId,
      expressions: base.modelExpressions.map(({ contextKey, modelKey, locale, positive, negative }) => ({
        contextKey,
        modelKey,
        locale,
        positive,
        negative,
      })),
    };
    const values = draft ? parsePersistedTermDraft(text(draft.payload)) : approved;
    const classifications = draft
      ? (() => {
          const categoriesById = new Map(this.getCategories(locale).map((category) => [category.id, category]));
          return values.classificationIds
            .map((classificationId) => categoriesById.get(classificationId))
            .filter((category): category is TermCategoryDto => Boolean(category));
        })()
      : base.classifications;
    return {
      ...base,
      ...values,
      classifications,
      modelExpressions: values.expressions.map((expression, index) => ({
        id: base.modelExpressions[index]?.id ?? `draft-expression-${index}`,
        ...expression,
      })),
      media,
      draftUpdatedAt: draft ? text(draft.updated_at) : null,
    };
  }

  listTermMedia(termId: string): TermMediaItemDto[] {
    return (
      this.db
        .prepare(
          `SELECT l.*, a.kind AS asset_kind, a.origin_type AS asset_origin_type,
        a.width AS asset_width, a.height AS asset_height, a.mime_type AS asset_mime_type,
        a.byte_size AS asset_byte_size, a.created_at AS asset_created_at
        FROM term_media_links l JOIN image_assets a ON a.id = l.image_asset_id
        WHERE l.term_id = ? AND l.deleted_at IS NULL AND a.deleted_at IS NULL
        ORDER BY CASE l.role WHEN 'COVER' THEN 0 ELSE 1 END, l.sort_order, l.created_at`,
        )
        .all(termId) as JsonMap[]
    ).map((row) => this.termMediaItem(row));
  }

  addTermMedia(input: AddTermMediaInput): TermMediaItemDto[];

  addTermMedia(input: AddTermMediaInput, options: { returnItems: false }): void;

  addTermMedia(input: AddTermMediaInput, options?: { returnItems: false }): TermMediaItemDto[] | void {
    const assetIds = [...new Set(input.assetIds)];
    if (!this.db.prepare('SELECT 1 FROM terms WHERE id = ? AND archived_at IS NULL').get(input.termId)) {
      throw new Error('Active term not found');
    }
    this.db
      .transaction(() => {
        const hasCover = Boolean(
          this.db
            .prepare(
              `SELECT 1 FROM term_media_links
          WHERE term_id = ? AND role = 'COVER' AND deleted_at IS NULL`,
            )
            .get(input.termId),
        );
        const maximum = this.db
          .prepare(
            `SELECT COALESCE(MAX(sort_order), -1) AS maximum FROM term_media_links
          WHERE term_id = ? AND deleted_at IS NULL`,
          )
          .get(input.termId) as JsonMap;
        let sortOrder = Number(maximum.maximum) + 1;
        let coverAssigned = hasCover || Number(maximum.maximum) >= 0;
        const slots = assetIds.map(() => '?').join(', ');
        const availableAssetIds = new Set(
          (assetIds.length
            ? (this.db
                .prepare(`SELECT id FROM image_assets WHERE id IN (${slots}) AND deleted_at IS NULL`)
                .all(...assetIds) as JsonMap[])
            : []
          ).map((row) => text(row.id)),
        );
        if (availableAssetIds.size !== assetIds.length) throw new Error('Image asset not found');
        const linkedAssetIds = new Set(
          (assetIds.length
            ? (this.db
                .prepare(
                  `SELECT image_asset_id FROM term_media_links
                    WHERE term_id = ? AND image_asset_id IN (${slots}) AND deleted_at IS NULL`,
                )
                .all(input.termId, ...assetIds) as JsonMap[])
            : []
          ).map((row) => text(row.image_asset_id)),
        );
        const insertLink = this.db.prepare(
          `INSERT INTO term_media_links
            (id, term_id, image_asset_id, role, sort_order, focal_x, focal_y, created_at, deleted_at)
            VALUES (?, ?, ?, ?, ?, 0.5, 0.5, ?, NULL)`,
        );
        for (const assetId of assetIds) {
          if (linkedAssetIds.has(assetId)) continue;
          const mediaId = ulid();
          const role = coverAssigned ? 'RELATED' : 'COVER';
          coverAssigned = true;
          insertLink.run(mediaId, input.termId, assetId, role, sortOrder++, now());
          this.storage.recordChange('TERM_MEDIA_LINK', mediaId, 'CREATE', { termId: input.termId, assetId, role });
        }
        if (input.preferredRole === 'COVER' && assetIds[0]) {
          const preferred = this.db
            .prepare(
              `SELECT id, role FROM term_media_links
                WHERE term_id = ? AND image_asset_id = ? AND deleted_at IS NULL`,
            )
            .get(input.termId, assetIds[0]) as JsonMap | undefined;
          if (preferred && text(preferred.role) !== 'COVER') this.setTermMediaCover(text(preferred.id));
        }
      })
      .immediate();
    if (options?.returnItems === false) return;
    return this.listTermMedia(input.termId);
  }

  setTermMediaCover(mediaId: string): TermMediaItemDto[] {
    const row = this.db
      .prepare(
        `SELECT l.term_id, l.role FROM term_media_links l
        JOIN terms t ON t.id = l.term_id
        JOIN image_assets a ON a.id = l.image_asset_id
        WHERE l.id = ? AND l.deleted_at IS NULL AND t.archived_at IS NULL AND a.deleted_at IS NULL`,
      )
      .get(mediaId) as JsonMap | undefined;
    if (!row) throw new Error('Active term image not found');
    const termId = text(row.term_id);
    if (row.role === 'COVER') return this.listTermMedia(termId);
    const orderedIds = this.listTermMedia(termId).map((item) => item.id);
    return this.reorderTermMedia({ termId, mediaIds: [mediaId, ...orderedIds.filter((id) => id !== mediaId)] });
  }

  removeTermMedia(mediaId: string): TermMediaItemDto[] {
    const row = this.db
      .prepare(
        `SELECT term_id FROM term_media_links
        WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(mediaId) as JsonMap | undefined;
    if (!row) throw new Error('Term image not found');
    const termId = text(row.term_id);
    this.db.transaction(() => {
      const deletedAt = now();
      this.db.prepare('UPDATE term_media_links SET deleted_at = ? WHERE id = ?').run(deletedAt, mediaId);
      this.db
        .prepare("INSERT INTO tombstones VALUES (?, 'TERM_MEDIA_LINK', ?, ?, 'LOCAL_ONLY')")
        .run(ulid(), mediaId, deletedAt);
      this.storage.recordChange('TERM_MEDIA_LINK', mediaId, 'DELETE', { termId });
      const remaining = this.db
        .prepare(
          `SELECT id FROM term_media_links
          WHERE term_id = ? AND deleted_at IS NULL
          ORDER BY CASE role WHEN 'COVER' THEN 0 ELSE 1 END, sort_order, created_at`,
        )
        .all(termId) as JsonMap[];
      const updateLink = this.db.prepare('UPDATE term_media_links SET role = ?, sort_order = ? WHERE id = ?');
      for (const [sortOrder, item] of remaining.entries()) {
        const id = text(item.id);
        const role = sortOrder === 0 ? 'COVER' : 'RELATED';
        updateLink.run(role, sortOrder, id);
        this.storage.recordChange('TERM_MEDIA_LINK', id, 'REORDER', { termId, sortOrder, role });
      }
    })();
    return this.listTermMedia(termId);
  }

  reorderTermMedia(input: ReorderTermMediaInput): TermMediaItemDto[] {
    const mediaIds = [...new Set(input.mediaIds)];
    const active = this.db
      .prepare(
        `SELECT l.id FROM term_media_links l
        JOIN image_assets a ON a.id = l.image_asset_id
        WHERE l.term_id = ? AND l.deleted_at IS NULL AND a.deleted_at IS NULL
        ORDER BY CASE l.role WHEN 'COVER' THEN 0 ELSE 1 END, l.sort_order, l.created_at`,
      )
      .all(input.termId) as JsonMap[];
    const activeIds = active.map((row) => text(row.id));
    if (mediaIds.length !== activeIds.length || activeIds.some((id) => !mediaIds.includes(id))) {
      throw new Error('Term image order is incomplete');
    }
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE term_media_links SET role = 'RELATED'
          WHERE term_id = ? AND deleted_at IS NULL`,
        )
        .run(input.termId);
      const updateLink = this.db.prepare('UPDATE term_media_links SET role = ?, sort_order = ? WHERE id = ?');
      for (const [sortOrder, mediaId] of mediaIds.entries()) {
        const role = sortOrder === 0 ? 'COVER' : 'RELATED';
        updateLink.run(role, sortOrder, mediaId);
        this.storage.recordChange('TERM_MEDIA_LINK', mediaId, 'REORDER', { termId: input.termId, sortOrder, role });
      }
    })();
    return this.listTermMedia(input.termId);
  }

  private normalizeDraft(input: TermDraftInput): TermDraftInput {
    const locale = input.titleLocale.trim().toLowerCase();
    const title = input.title.trim();
    if (!title) throw new Error('Title is required');
    if (!locale) throw new Error('Title language is required');
    const unique = (values: string[]) => [...new Set(values.map((value) => value.trim()).filter(Boolean))];
    const localizationLocales = new Set<string>();
    const localizations = input.localizations.map((item) => {
      const itemLocale = item.locale.trim().toLowerCase();
      if (!itemLocale || !item.title.trim()) throw new Error('Each localization needs a language and title');
      if (itemLocale === locale) throw new Error('The primary title language cannot also be a localization');
      if (localizationLocales.has(itemLocale)) throw new Error(`Duplicate localization language: ${itemLocale}`);
      localizationLocales.add(itemLocale);
      return {
        locale: itemLocale,
        title: item.title.trim(),
        definition: item.definition.trim(),
        aliases: unique(item.aliases),
      };
    });
    const expressionKeys = new Set<string>();
    const expressions = input.expressions
      .map((item) => ({
        contextKey: item.contextKey.trim().toLocaleLowerCase(),
        modelKey: item.modelKey.trim(),
        locale: item.locale.trim().toLowerCase(),
        positive: item.positive.trim(),
        negative: item.negative.trim(),
      }))
      .filter((item) => item.contextKey || item.modelKey || item.locale || item.positive || item.negative)
      .map((item) => {
        if (!item.contextKey || !item.modelKey || !item.locale) {
          throw new Error('Each model expression needs a context, model, and language');
        }
        if (!/^[a-z][a-z0-9._-]{1,63}$/.test(item.contextKey)) {
          throw new Error(`Invalid expression context key: ${item.contextKey}`);
        }
        const key = `${item.contextKey}\u0000${item.modelKey}\u0000${item.locale}`;
        if (expressionKeys.has(key)) {
          throw new Error(`Duplicate model expression: ${item.contextKey} / ${item.modelKey} / ${item.locale}`);
        }
        expressionKeys.add(key);
        return item;
      });
    const classificationIds = unique(input.classificationIds);
    const primaryDirectoryClassificationId = input.primaryDirectoryClassificationId?.trim() || null;
    return {
      termId: input.termId,
      title,
      titleLocale: locale,
      definition: input.definition.trim(),
      aliases: unique(input.aliases),
      localizations,
      classificationIds,
      primaryDirectoryClassificationId,
      expressions,
    };
  }

  saveTermDraft(input: TermDraftInput, locale: Locale): TermEditorDto {
    if (!this.db.prepare('SELECT 1 FROM terms WHERE id = ? AND archived_at IS NULL').get(input.termId))
      throw new Error('Active term not found');
    const payload = this.normalizeDraft(termDraftSchema.parse(input));
    this.db
      .prepare(
        `INSERT INTO drafts(id, entity_type, entity_id, payload, updated_at) VALUES (?, 'TERM', ?, ?, ?)
        ON CONFLICT(entity_type, entity_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      )
      .run(ulid(), input.termId, JSON.stringify(payload), now());
    return this.getTerm(input.termId, locale);
  }

  createTerm(input: NewTermInput): TermEditorDto {
    const title = input.title.trim();
    const titleLocale = input.titleLocale.trim().toLowerCase();
    const classificationId = input.classificationId?.trim() || null;
    if (!title) throw new Error('Title is required');
    if (!titleLocale) throw new Error('Title language is required');
    const initialCategory = classificationId
      ? (this.db
          .prepare(
            `SELECT id, primary_facet_value_id, secondary_facet_value_id
              FROM term_categories WHERE id = ? AND state = 'ACTIVE'`,
          )
          .get(classificationId) as JsonMap | undefined)
      : undefined;
    if (classificationId && !initialCategory) {
      throw new Error('Active classification not found');
    }
    const termId = ulid();
    const revisionId = ulid();
    const stableKey = `term.local.${termId.toLowerCase()}`;
    const draft: TermDraftInput = {
      termId,
      title,
      titleLocale,
      definition: '',
      aliases: [],
      localizations: [],
      classificationIds: classificationId ? [classificationId] : [],
      primaryDirectoryClassificationId: classificationId,
      expressions: [],
    };
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO terms(id, stable_key, current_revision_id, editorial_state, archived_at)
            VALUES (?, ?, ?, 'DRAFT', NULL)`,
        )
        .run(termId, stableKey, revisionId);
      this.db
        .prepare(
          `INSERT INTO term_revisions
            (id, term_id, revision_no, title, title_locale, definition, created_at)
            VALUES (?, ?, 1, ?, ?, '', ?)`,
        )
        .run(revisionId, termId, title, titleLocale, now());
      if (initialCategory && classificationId) {
        this.db
          .prepare(
            'INSERT INTO term_revision_categories(id, term_revision_id, category_id, sort_order) VALUES (?, ?, ?, 0)',
          )
          .run(ulid(), revisionId, classificationId);
        const initialFacetValueIds = [
          text(initialCategory.primary_facet_value_id),
          initialCategory.secondary_facet_value_id ? text(initialCategory.secondary_facet_value_id) : '',
        ].filter(Boolean);
        const insertFacet = this.db.prepare('INSERT INTO term_facet_assignments VALUES (?, ?, ?)');
        for (const facetValueId of new Set(initialFacetValueIds)) insertFacet.run(ulid(), revisionId, facetValueId);
      }
      this.db
        .prepare("INSERT INTO drafts(id, entity_type, entity_id, payload, updated_at) VALUES (?, 'TERM', ?, ?, ?)")
        .run(ulid(), termId, JSON.stringify(draft), now());
      this.storage.recordChange('TERM', termId, 'CREATE_DRAFT', { classificationId });
    })();
    return this.getTerm(termId, input.uiLocale);
  }

  approveTerm(termId: string, locale: Locale): TermEditorDto {
    if (!this.db.prepare('SELECT 1 FROM terms WHERE id = ? AND archived_at IS NULL').get(termId))
      throw new Error('Active term not found');
    const draft = this.db
      .prepare("SELECT payload FROM drafts WHERE entity_type = 'TERM' AND entity_id = ?")
      .get(termId) as JsonMap | undefined;
    if (!draft) throw new Error('No draft to approve');
    const input = this.normalizeDraft(parsePersistedTermDraft(text(draft.payload)));
    if (!input.definition) throw new Error('Definition is required before approval');
    if (!input.classificationIds.length) throw new Error('At least one classification is required before approval');
    if (!input.primaryDirectoryClassificationId) {
      throw new Error('Primary directory classification is required before approval');
    }
    if (!input.classificationIds.includes(input.primaryDirectoryClassificationId)) {
      throw new Error('Primary directory classification must be one of the selected classifications');
    }
    if (!input.expressions.some((expression) => expression.positive)) {
      throw new Error('At least one positive model expression is required before approval');
    }
    const selectedCategories = this.db
      .prepare(
        `SELECT id, primary_facet_value_id, secondary_facet_value_id
          FROM term_categories
          WHERE id IN (${input.classificationIds.map(() => '?').join(',')})`,
      )
      .all(...input.classificationIds) as JsonMap[];
    if (selectedCategories.length !== input.classificationIds.length) throw new Error('Classification not found');
    const primaryDirectoryCategory = this.db
      .prepare('SELECT id, primary_facet_value_id, secondary_facet_value_id FROM term_categories WHERE id = ?')
      .get(input.primaryDirectoryClassificationId) as JsonMap | undefined;
    if (!primaryDirectoryCategory) throw new Error('Primary directory classification not found');

    this.db.transaction(() => {
      const current = this.db
        .prepare(
          `SELECT t.current_revision_id, r.revision_no, placement.primary_category_id
            FROM terms t
            JOIN term_revisions r ON r.id = t.current_revision_id
            LEFT JOIN term_directory_placements placement ON placement.term_id = t.id
            WHERE t.id = ?`,
        )
        .get(termId) as JsonMap;
      const revisionId = ulid();
      const revisionNo = Number(current.revision_no) + 1;
      const baseReleaseItemIds = this.termBaseReleaseItemIds(termId, text(current.current_revision_id));
      this.db
        .prepare(
          `INSERT INTO term_revisions
            (id, term_id, revision_no, title, title_locale, definition, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(revisionId, termId, revisionNo, input.title, input.titleLocale, input.definition, now());
      const insertAlias = this.db.prepare('INSERT INTO term_aliases VALUES (?, ?, ?, ?, ?)');
      for (const value of input.aliases) {
        insertAlias.run(ulid(), revisionId, input.titleLocale, value, value.toLowerCase());
      }
      const insertLocalization = this.db.prepare('INSERT INTO term_localizations VALUES (?, ?, ?, ?, ?)');
      for (const localization of input.localizations) {
        insertLocalization.run(ulid(), revisionId, localization.locale, localization.title, localization.definition);
        for (const value of localization.aliases) {
          insertAlias.run(ulid(), revisionId, localization.locale, value, value.toLowerCase());
        }
      }
      const insertExpression = this.db.prepare(
        `INSERT INTO term_expressions
          (id, term_revision_id, context_profile_revision_id, model_key, locale,
            positive_expression, negative_expression)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const contextProfileRevisions = new Map<string, string>();
      for (const expression of input.expressions) {
        const contextProfileRevisionId =
          contextProfileRevisions.get(expression.contextKey) ??
          this.ensureTermContextProfileRevision(termId, revisionId, expression.contextKey);
        contextProfileRevisions.set(expression.contextKey, contextProfileRevisionId);
        insertExpression.run(
          ulid(),
          revisionId,
          contextProfileRevisionId,
          expression.modelKey,
          expression.locale,
          expression.positive,
          expression.negative,
        );
      }
      const previousFacetRows = this.db
        .prepare(
          `SELECT assignment.facet_value_id
            FROM term_facet_assignments assignment
            JOIN facet_values value ON value.id = assignment.facet_value_id
            JOIN facet_definitions definition ON definition.id = value.definition_id
            WHERE assignment.term_revision_id = ? AND definition.system_role IS NULL`,
        )
        .all(text(current.current_revision_id)) as JsonMap[];
      const facetValueIds = new Set([
        ...previousFacetRows.map((row) => text(row.facet_value_id)),
        ...selectedCategories.flatMap((category) => [
          text(category.primary_facet_value_id),
          text(category.secondary_facet_value_id),
        ]),
      ]);
      const insertFacet = this.db.prepare('INSERT INTO term_facet_assignments VALUES (?, ?, ?)');
      for (const facetValueId of [...facetValueIds].filter(Boolean)) {
        insertFacet.run(ulid(), revisionId, facetValueId);
      }
      const insertClassification = this.db.prepare(
        'INSERT INTO term_revision_categories(id, term_revision_id, category_id, sort_order) VALUES (?, ?, ?, ?)',
      );
      for (const [sortOrder, classificationId] of input.classificationIds.entries()) {
        insertClassification.run(ulid(), revisionId, classificationId, sortOrder);
      }
      this.db
        .prepare("UPDATE terms SET current_revision_id = ?, editorial_state = 'APPROVED' WHERE id = ?")
        .run(revisionId, termId);
      const primaryDirectoryChanged = text(current.primary_category_id) !== input.primaryDirectoryClassificationId;
      if (primaryDirectoryChanged) {
        this.db
          .prepare(
            `UPDATE term_directory_placements
              SET primary_category_id = ?, domain_facet_value_id = ?, item_type_facet_value_id = ?, updated_at = ?
              WHERE term_id = ?`,
          )
          .run(
            input.primaryDirectoryClassificationId,
            primaryDirectoryCategory.primary_facet_value_id,
            primaryDirectoryCategory.secondary_facet_value_id,
            now(),
            termId,
          );
      }
      this.db.prepare("DELETE FROM drafts WHERE entity_type = 'TERM' AND entity_id = ?").run(termId);
      this.upsertTermLocalOverrides({
        termId,
        baseRevisionId: text(current.current_revision_id),
        revisionId,
        revisionNo,
        input,
        baseReleaseItemIds,
      });
      this.storage.recordChange(
        'TERM',
        termId,
        'APPROVE_REVISION',
        { revisionId, revisionNo, primaryDirectoryChanged },
        { affectsFileView: primaryDirectoryChanged },
      );
    })();
    return this.getTerm(termId, locale);
  }

  private ensureTermContextProfileRevision(termId: string, termRevisionId: string, contextKey: string) {
    let profile = this.db
      .prepare('SELECT id FROM term_context_profiles WHERE term_id = ? AND stable_key = ?')
      .get(termId, contextKey) as JsonMap | undefined;
    if (!profile) {
      const profileId = ulid();
      this.db
        .prepare('INSERT INTO term_context_profiles(id, term_id, stable_key, created_at) VALUES (?, ?, ?, ?)')
        .run(profileId, termId, contextKey, now());
      profile = { id: profileId };
    }
    const existingRevision = this.db
      .prepare(
        `SELECT id FROM term_context_profile_revisions
          WHERE context_profile_id = ? AND term_revision_id = ?`,
      )
      .get(profile.id, termRevisionId) as JsonMap | undefined;
    if (existingRevision) return text(existingRevision.id);
    const profileRevisionId = ulid();
    this.db
      .prepare(
        `INSERT INTO term_context_profile_revisions(
            id, context_profile_id, term_revision_id, definition, exclusion_boundary, created_at
          ) VALUES (?, ?, ?, '', '', ?)`,
      )
      .run(profileRevisionId, profile.id, termRevisionId, now());
    return profileRevisionId;
  }

  private termBaseReleaseItemIds(termId: string, currentRevisionId: string) {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT release_item_id AS base_release_item_id
          FROM pack_object_links
          WHERE local_object_type = 'TERM' AND local_object_id = ?
            AND local_revision_id = ? AND deleted_at IS NULL
          UNION
          SELECT DISTINCT override.base_release_item_id
          FROM local_overrides override
          JOIN term_revisions revision ON revision.id = override.local_revision_id
          WHERE revision.term_id = ? AND override.local_object_type = 'TERM'
            AND override.deleted_at IS NULL AND override.state <> 'SUPERSEDED'`,
      )
      .all(termId, currentRevisionId, termId) as JsonMap[];
    return rows.map((row) => text(row.base_release_item_id)).filter(Boolean);
  }

  private upsertTermLocalOverrides({
    termId,
    baseRevisionId,
    revisionId,
    revisionNo,
    input,
    baseReleaseItemIds,
  }: {
    termId: string;
    baseRevisionId: string;
    revisionId: string;
    revisionNo: number;
    input: TermDraftInput;
    baseReleaseItemIds: string[];
  }) {
    if (!baseReleaseItemIds.length) return;
    const space = this.db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').get() as JsonMap | undefined;
    if (!space) throw new Error('Local space is unavailable');
    const contentHash = `sha256:${createHash('sha256')
      .update(
        JSON.stringify({
          title: input.title,
          titleLocale: input.titleLocale,
          definition: input.definition,
          aliases: input.aliases,
          localizations: input.localizations,
          classificationIds: input.classificationIds,
          primaryDirectoryClassificationId: input.primaryDirectoryClassificationId,
          expressions: input.expressions,
        }),
      )
      .digest('hex')}`;
    const timestamp = now();
    for (const baseReleaseItemId of baseReleaseItemIds) {
      const existing = this.db
        .prepare(
          `SELECT id FROM local_overrides
            WHERE space_id = ? AND base_release_item_id = ? AND override_kind = 'REPLACE'
              AND scope_type = 'SPACE' AND scope_id = '' AND deleted_at IS NULL`,
        )
        .get(space.id, baseReleaseItemId) as JsonMap | undefined;
      const overrideId = existing ? text(existing.id) : ulid();
      const patch = JSON.stringify({ termId, baseRevisionId, revisionNo });
      if (existing) {
        this.db
          .prepare(
            `UPDATE local_overrides
              SET local_object_type = 'TERM', local_revision_id = ?, local_content_hash = ?,
                patch_json = ?, state = 'ACTIVE', updated_at = ?
              WHERE id = ?`,
          )
          .run(revisionId, contentHash, patch, timestamp, overrideId);
      } else {
        this.db
          .prepare(
            `INSERT INTO local_overrides(
                id, space_id, base_release_item_id, override_kind, local_object_type,
                local_revision_id, local_content_hash, patch_json, scope_type, scope_id,
                state, created_at, updated_at, deleted_at
              ) VALUES (?, ?, ?, 'REPLACE', 'TERM', ?, ?, ?, 'SPACE', '', 'ACTIVE', ?, ?, NULL)`,
          )
          .run(overrideId, space.id, baseReleaseItemId, revisionId, contentHash, patch, timestamp, timestamp);
      }
      this.storage.recordChange('LOCAL_OVERRIDE', overrideId, existing ? 'UPDATE' : 'CREATE', {
        termId,
        baseReleaseItemId,
        scopeType: 'SPACE',
      });
    }
  }

  withdrawTermApproval(termId: string, locale: Locale): TermEditorDto {
    const row = this.db.prepare('SELECT editorial_state, archived_at FROM terms WHERE id = ?').get(termId) as
      JsonMap | undefined;
    if (!row) throw new Error('Term not found');
    if (row.archived_at) throw new Error('Deleted term cannot be withdrawn');
    if (row.editorial_state !== 'APPROVED') throw new Error('Only an approved term can be withdrawn');
    const current = this.getTerm(termId, locale);
    const payload = this.toDraftPayload(termId, current);
    this.db.transaction(() => {
      this.db.prepare("UPDATE terms SET editorial_state = 'DRAFT' WHERE id = ?").run(termId);
      this.db
        .prepare(
          `INSERT INTO drafts(id, entity_type, entity_id, payload, updated_at) VALUES (?, 'TERM', ?, ?, ?)
          ON CONFLICT(entity_type, entity_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
        )
        .run(ulid(), termId, JSON.stringify(payload), now());
      this.storage.recordChange('TERM', termId, 'WITHDRAW_APPROVAL', { revisionNo: current.revisionNo });
    })();
    return this.getTerm(termId, locale);
  }

  setTermArchived(termId: string, archived: boolean, locale: Locale): TermEditorDto {
    const row = this.db.prepare('SELECT archived_at FROM terms WHERE id = ?').get(termId) as JsonMap | undefined;
    if (!row) throw new Error('Term not found');
    if (Boolean(row.archived_at) === archived) return this.getTerm(termId, locale);
    const current = this.getTerm(termId, locale);
    const payload = this.toDraftPayload(termId, current);
    this.db.transaction(() => {
      if (archived) {
        this.db
          .prepare("UPDATE terms SET archived_at = ?, editorial_state = 'ARCHIVED' WHERE id = ?")
          .run(now(), termId);
        this.db.prepare("DELETE FROM drafts WHERE entity_type = 'TERM' AND entity_id = ?").run(termId);
        this.storage.recordChange('TERM', termId, 'ARCHIVE', { revisionNo: current.revisionNo });
      } else {
        this.db.prepare("UPDATE terms SET archived_at = NULL, editorial_state = 'DRAFT' WHERE id = ?").run(termId);
        this.db
          .prepare(
            `INSERT INTO drafts(id, entity_type, entity_id, payload, updated_at) VALUES (?, 'TERM', ?, ?, ?)
            ON CONFLICT(entity_type, entity_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
          )
          .run(ulid(), termId, JSON.stringify(payload), now());
        this.storage.recordChange('TERM', termId, 'RESTORE', { revisionNo: current.revisionNo });
      }
    })();
    return this.getTerm(termId, locale);
  }

  private toDraftPayload(termId: string, current: TermEditorDto): TermDraftInput {
    return {
      termId,
      title: current.title,
      titleLocale: current.titleLocale,
      definition: current.definition,
      aliases: current.aliases,
      localizations: current.localizations,
      classificationIds: current.classificationIds,
      primaryDirectoryClassificationId: current.primaryDirectoryClassificationId,
      expressions: current.expressions,
    };
  }
}
