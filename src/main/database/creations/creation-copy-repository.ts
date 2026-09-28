import { createHash, randomUUID } from 'node:crypto';
import { ArticleElementRepository } from '@/main/database/creations/article-element-repository';
import { blockDocumentPlacements } from '@/shared/block-document-placements';
import { creationItemIncludesSeries } from '@/main/database/creations/creation-output-presentation-sql';
import { ulid } from 'ulid';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import { now } from '@/main/database/core/values';
import type { CreationFormEntityRef } from '@/shared/contracts/creation-library';
import {
  creationFormAddOrGetInputSchema,
  creationItemCreateWithFormInputSchema,
  creationPrimaryFormRoleSchema,
  type CreationFormAddOrGetResult,
} from '@/shared/contracts/creation-library';
import type { CreationOutlineTarget } from '@/shared/contracts/creation-outline';
import { canonicalArticleContentJson } from '@/shared/contracts/article';
import { canonicalSocialPostContentJson } from '@/shared/contracts/social-post';
import { copyLinkedBlockDocument } from '@/shared/block-anchor-copy';
import { blockDocumentSchema, type BlockNode } from '@/shared/contracts/block-document';
import { gifManifestSchema, gifWorkspaceStateSchema } from '@/shared/contracts/gif-making';

type Row = Record<string, string | number | null>;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** One bounded, transactional snapshot. Media and fixed references stay shared; execution/history tables are never copied. */
export class CreationCopyRepository {
  private readonly identities = new Map<string, string>();
  private readonly entities = new Map<string, string>();
  private readonly creations = new Map<string, string>();
  private readonly timestamp = now();
  private rows = 0;
  private bytes = 0;
  constructor(private readonly repositories: LibraryDatabaseRepositories) {}
  private get db() {
    return this.repositories.db;
  }
  private identity(id: string, uuid = false) {
    let copied = this.identities.get(id);
    if (!copied) {
      copied = uuid ? randomUUID() : ulid();
      this.identities.set(id, copied);
    }
    return copied;
  }
  private row(table: string, id: string): Row {
    const row = this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | undefined;
    if (!row || row.deleted_at || row.archived_at) throw new Error('COPY_SOURCE_UNAVAILABLE');
    return row;
  }
  private insert(table: string, source: Row, overrides: Row = {}) {
    if (++this.rows > 4000) throw new Error('COPY_LIMIT');
    const row = { ...source, ...overrides };
    for (const field of ['created_at', 'updated_at', 'content_updated_at'])
      if (field in row) row[field] = this.timestamp;
    this.bytes += Buffer.byteLength(JSON.stringify(row));
    if (this.bytes > 32 * 1024 * 1024) throw new Error('COPY_LIMIT');
    const columns = Object.keys(row);
    this.db
      .prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
      .run(...columns.map((column) => row[column]));
  }
  private children(table: string, column: string, source: string, destination: string, overrides: Row = {}) {
    const rows = this.db.prepare(`SELECT * FROM ${table} WHERE ${column} = ? LIMIT 4001`).all(source) as Row[];
    for (const row of rows) {
      if (row.deleted_at) continue;
      this.insert(table, row, {
        ...(typeof row.id === 'string' ? { id: this.identity(row.id) } : {}),
        [column]: destination,
        ...overrides,
      });
    }
  }
  private copyDocument(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((entry) => this.copyDocument(entry));
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    if (record.format === 'PROSEMIRROR_JSON') {
      const before = blockDocumentSchema.parse(record);
      const copied = copyLinkedBlockDocument(before.root);
      const remember = (old: BlockNode, next: BlockNode) => {
        if (typeof old.attrs?.blockId === 'string' && typeof next.attrs?.blockId === 'string')
          this.identities.set(old.attrs.blockId, next.attrs.blockId);
        old.content?.forEach((child, index) => remember(child, next.content![index]));
      };
      remember(before.root, copied.root);
      return copied;
    }
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, this.copyDocument(entry)]));
  }

  private reboundAnchor(value: string | number | null) {
    const visit = (entry: unknown): unknown => {
      if (typeof entry === 'string') return this.identities.get(entry) ?? entry;
      if (Array.isArray(entry)) return entry.map(visit);
      if (entry && typeof entry === 'object')
        return Object.fromEntries(Object.entries(entry).map(([key, child]) => [key, visit(child)]));
      return entry;
    };
    return JSON.stringify(visit(JSON.parse(String(value))));
  }

  copy(targets: readonly CreationOutlineTarget[], albumId: string | null) {
    return targets.map((target) =>
      target.kind === 'ALBUM' ? this.album(target.id, albumId) : this.creation(target.id, albumId),
    );
  }

  private album(id: string, parentId: string | null, ancestors = new Set<string>()): string {
    if (ancestors.has(id) || ancestors.size > 100) throw new Error('COPY_INVALID_TREE');
    const row = this.row('albums', id);
    if (
      parentId &&
      (this.row('albums', parentId).intent === 'MATERIAL_LIBRARY') !== (row.intent === 'MATERIAL_LIBRARY')
    )
      throw new Error('COPY_INVALID_DESTINATION');
    const next = this.identity(id);
    this.insert('albums', row, { id: next, pinned: 0 });
    this.children('album_localizations', 'album_id', id, next);
    const children = this.db
      .prepare('SELECT * FROM album_members WHERE album_id = ? AND deleted_at IS NULL ORDER BY sort_order LIMIT 4001')
      .all(id) as Row[];
    const lineage = new Set([...ancestors, id]);
    for (const child of children) {
      let targetId = String(child.target_id);
      if (child.target_type === 'ALBUM') targetId = this.album(targetId, next, lineage);
      else if (child.target_type === 'CREATION_ITEM') targetId = this.creation(targetId, next);
      else if (child.target_type === 'MATERIAL') {
        this.row('materials', targetId);
        const memberId = ulid();
        this.insert('album_members', child, { id: memberId, album_id: next });
        this.repositories.storage.recordChange('ALBUM_MEMBER', memberId, 'CREATE', {
          albumId: next,
          targetType: 'MATERIAL',
          targetId,
        });
      } else throw new Error('COPY_MEMBER_UNSUPPORTED');
      this.db
        .prepare(
          'UPDATE album_members SET sort_order = ? WHERE album_id = ? AND target_type = ? AND target_id = ? AND deleted_at IS NULL',
        )
        .run(child.sort_order, next, child.target_type, targetId);
    }
    if (row.intent === 'MATERIAL_LIBRARY')
      this.repositories.materialAlbums.move({ albumId: next, parentAlbumId: parentId });
    else this.repositories.albums.move({ albumId: next, parentAlbumId: parentId });
    const note = this.db
      .prepare(
        `SELECT note.article_id, item.id AS creation_item_id FROM album_notes note
      JOIN articles article ON article.id = note.article_id AND article.deleted_at IS NULL AND article.status = 'ACTIVE'
      JOIN creation_forms form ON form.entity_type = 'ARTICLE' AND form.entity_id = note.article_id AND form.deleted_at IS NULL
      JOIN creation_items item ON item.id = form.creation_item_id AND item.deleted_at IS NULL AND item.archived_at IS NULL
      WHERE note.album_id = ?`,
      )
      .get(id) as { article_id: string; creation_item_id: string } | undefined;
    if (note) this.creation(note.creation_item_id, next);
    const copiedNote = note ? this.entities.get('ARTICLE:' + note.article_id) : undefined;
    if (copiedNote)
      this.db.prepare('INSERT INTO album_notes(album_id, article_id) VALUES (?, ?)').run(next, copiedNote);
    this.repositories.storage.recordChange('ALBUM', next, 'CREATE', { copiedFrom: id, parentAlbumId: parentId });
    return next;
  }

  private creation(id: string, albumId: string | null, ancestors = new Set<string>()): string {
    if (ancestors.has(id) || ancestors.size > 100) throw new Error('COPY_INVALID_TREE');
    const existing = this.creations.get(id);
    if (existing) return existing;
    const original = this.repositories.creationItems.get(id);
    if (original.lifecycle !== 'ACTIVE') throw new Error('COPY_SOURCE_UNAVAILABLE');
    const pending = [...original.forms];
    const forms = new Map<string, string>();
    let copiedId: string | null = null;
    while (pending.length) {
      const index = pending.findIndex(
        (form) =>
          (!form.sourceFormId || forms.has(form.sourceFormId)) &&
          (copiedId || creationPrimaryFormRoleSchema.safeParse(form.role).success || form.role === 'INSPIRATION'),
      );
      if (index < 0) throw new Error('COPY_INVALID_LINEAGE');
      const form = pending.splice(index, 1)[0];
      const entity = { ...form.entity, id: this.entity(form.entity, albumId) };
      const input = {
        role: form.role,
        entity,
        sourceFormId: form.sourceFormId ? forms.get(form.sourceFormId)! : null,
        anchorKey: form.anchorKey
          ? form.anchorKey
              .split(':')
              .map((part) => this.identities.get(part) ?? part)
              .join(':')
          : null,
      };
      const result: CreationFormAddOrGetResult = copiedId
        ? this.repositories.creationItems.addForm(
            creationFormAddOrGetInputSchema.parse({ ...input, creationItemId: copiedId }),
          )
        : this.repositories.creationItems.createWithForm(
            creationItemCreateWithFormInputSchema.parse({
              albumId,
              form: { role: input.role, entity, anchorKey: input.anchorKey },
            }),
          );
      copiedId = result.item.id;
      forms.set(form.id, result.form.id);
      this.db.prepare('UPDATE creation_forms SET sort_order = ? WHERE id = ?').run(form.sortOrder, result.form.id);
    }
    if (!copiedId) throw new Error('COPY_EMPTY_CREATION');
    if (original.primaryFormId)
      this.repositories.creationItems.setPrimary({
        creationItemId: copiedId,
        formId: forms.get(original.primaryFormId)!,
      });
    this.db.prepare('UPDATE creation_items SET phase = ? WHERE id = ?').run(original.phase, copiedId);
    this.creations.set(id, copiedId);
    const children = this.db
      .prepare(
        `SELECT edge.creation_item_id, edge.sort_order FROM creation_item_parents edge
      JOIN creation_items item ON item.id = edge.creation_item_id
      WHERE edge.parent_creation_item_id = ? AND item.deleted_at IS NULL AND item.archived_at IS NULL
      ORDER BY edge.sort_order, edge.creation_item_id LIMIT 4001`,
      )
      .all(id) as { creation_item_id: string; sort_order: number }[];
    if (children.length > 4000) throw new Error('COPY_LIMIT');
    const lineage = new Set([...ancestors, id]);
    for (const child of children) {
      const childId = this.creation(child.creation_item_id, albumId, lineage);
      this.repositories.creationItems.move({ creationItemId: childId, albumId, parentCreationItemId: copiedId });
      this.db
        .prepare('UPDATE creation_item_parents SET sort_order = ? WHERE creation_item_id = ?')
        .run(child.sort_order, childId);
    }
    return copiedId;
  }

  private entity(entity: CreationFormEntityRef, albumId: string | null): string {
    const key = entity.kind + ':' + entity.id;
    const existing = this.entities.get(key);
    if (existing) return existing;
    const id = entity.id;
    const next = this.identity(id, entity.kind === 'GIF_DOCUMENT');
    switch (entity.kind) {
      case 'ARTICLE': {
        const source = this.repositories.articles.get(id);
        const { mediaAssets: _media, ...savedContent } = source.content;
        const content = this.copyDocument(savedContent) as typeof savedContent;
        this.revisionEntity(
          'articles',
          'article_revisions',
          'article_id',
          id,
          albumId,
          canonicalArticleContentJson(content),
        );
        if (content.document)
          new ArticleElementRepository(this.repositories.storage).savePlacements(
            next,
            this.identity(source.revisionId),
            blockDocumentPlacements(content.document),
            this.timestamp,
          );
        break;
      }
      case 'SOCIAL_POST': {
        const source = this.repositories.socialPosts.get(id);
        const content = this.copyDocument(source.content) as typeof source.content;
        this.revisionEntity(
          'social_post_drafts',
          'social_post_revisions',
          'draft_id',
          id,
          albumId,
          canonicalSocialPostContentJson(content),
        );
        break;
      }
      case 'EVALUATION_SUITE':
        this.revisionEntity('evaluation_suites', 'evaluation_suite_revisions', 'suite_id', id, albumId);
        break;
      case 'IMAGE_BREAKDOWN': {
        const row = this.row('image_breakdowns', id);
        this.insert('image_breakdowns', row, {
          id: next,
          status: row.result_json ? 'SUCCEEDED' : 'DRAFT',
          error_code: null,
          error_message: null,
        });
        break;
      }
      case 'PROMPT_SERIES':
        this.series(id);
        break;
      case 'GIF_DOCUMENT': {
        this.gif(id, albumId);
        break;
      }
      case 'VIDEO_DOCUMENT':
        this.video(id);
        break;
      case 'DERIVED_VISUAL':
        this.visual(id, albumId);
        break;
      case 'INSPIRATION_STASH':
        throw new Error('COPY_LEGACY_SOURCE_UNAVAILABLE');
      default: {
        const unreachable: never = entity;
        throw new Error(String(unreachable));
      }
    }
    this.entities.set(key, next);
    this.repositories.storage.recordChange(entity.kind, next, 'CREATE', { copiedFrom: id });
    return next;
  }

  private gif(id: string, albumId: string | null) {
    const row = this.row('gif_documents', id);
    const next = this.identity(id, true);
    const revision = this.db
      .prepare('SELECT * FROM gif_document_revisions WHERE document_id = ? AND revision = ?')
      .get(id, row.revision) as Row | undefined;
    if (!revision) throw new Error('COPY_SOURCE_UNAVAILABLE');
    const manifest = gifManifestSchema.parse(JSON.parse(String(revision.manifest_json)));
    if (manifest.motionDocumentId) {
      const motion = this.row('gif_documents', manifest.motionDocumentId);
      // Only the editor owns a motion document. Reject malformed links before recursion.
      if (row.purpose !== 'GIF' || motion.purpose !== 'MOTION' || motion.series_id !== row.series_id)
        throw new Error('COPY_INVALID_LINEAGE');
      manifest.motionDocumentId = this.entity({ kind: 'GIF_DOCUMENT', id: manifest.motionDocumentId }, albumId);
    }
    const seriesId = row.series_id ? this.entity({ kind: 'PROMPT_SERIES', id: String(row.series_id) }, albumId) : null;
    const frameIds = new Map(manifest.frames.map((frame) => [frame.id, randomUUID()]));
    manifest.frames = manifest.frames.map((frame) => ({ ...frame, id: frameIds.get(frame.id)! }));
    delete manifest.generationId;
    this.insert('gif_documents', row, { id: next, series_id: seriesId, revision: 1 });
    this.insert('gif_document_revisions', revision, {
      document_id: next,
      revision: 1,
      manifest_json: JSON.stringify(manifest),
    });
    const assets = this.db
      .prepare('SELECT * FROM gif_document_assets WHERE document_id = ? AND revision = ?')
      .all(id, row.revision) as Row[];
    for (const asset of assets) this.insert('gif_document_assets', asset, { document_id: next, revision: 1 });
    const workspace = this.db.prepare('SELECT * FROM gif_workspace_state WHERE document_id = ?').get(id) as
      Row | undefined;
    if (workspace) {
      const state = gifWorkspaceStateSchema.parse(JSON.parse(String(workspace.state_json)));
      if (state.step === 'review') state.step = manifest.frames.length ? 'edit' : 'generate';
      state.frameId = state.frameId ? frameIds.get(state.frameId) : undefined;
      delete state.candidateId;
      this.insert('gif_workspace_state', workspace, { document_id: next, state_json: JSON.stringify(state) });
    }
  }

  private revisionEntity(
    table: string,
    revisionTable: string,
    owner: string,
    id: string,
    albumId: string | null,
    content?: string,
  ) {
    const row = this.row(table, id);
    const revision = this.row(revisionTable, String(row.current_revision_id));
    const next = this.identity(id);
    const revisionId = this.identity(String(revision.id));
    this.insert(table, row, {
      id: next,
      album_id: albumId,
      current_revision_id: null,
      ...('source_inspiration_stash_id' in row ? { source_inspiration_stash_id: null } : {}),
    });
    this.insert(revisionTable, revision, {
      id: revisionId,
      [owner]: next,
      revision_no: 1,
      ...(content ? { content_json: content, content_hash: digest(content) } : {}),
      ...('content_pack_id' in revision ? { content_pack_id: null, content_pack_entry_index: null } : {}),
    });
    this.db.prepare(`UPDATE ${table} SET current_revision_id = ? WHERE id = ?`).run(revisionId, next);
  }

  private series(id: string) {
    const row = this.row('prompt_series', id);
    const next = this.identity(id);
    this.insert('prompt_series', row, { id: next, current_version_id: null });
    this.children('prompt_series_localizations', 'prompt_series_id', id, next);
    this.children('prompt_series_cover_assets', 'series_id', id, next);
    const version = row.current_version_id ? this.row('prompt_versions', String(row.current_version_id)) : null;
    const versionId = version ? this.identity(String(version.id)) : null;
    if (version) {
      this.insert('prompt_versions', version, {
        id: versionId,
        series_id: next,
        parent_version_id: null,
        version_no: 1,
      });
      for (const table of [
        'prompt_term_bindings',
        'prompt_palette_bindings',
        'reference_bindings',
        'prompt_input_snapshots',
      ])
        this.children(table, 'prompt_version_id', String(version.id), versionId!);
      this.db.prepare('UPDATE prompt_series SET current_version_id = ? WHERE id = ?').run(versionId, next);
    }
    // Exploration results are visible through their owner; flatten their current assets into the copied series.
    const sourceSeries = `WITH source_series AS (
      SELECT series.id FROM prompt_series series WHERE series.deleted_at IS NULL
        AND ${creationItemIncludesSeries('@source', 'series.id')}
    )`;
    const outputs = this.db
      .prepare(
        `${sourceSeries}
    SELECT DISTINCT output.image_asset_id FROM (
      SELECT imported.series_id, imported.image_asset_id FROM creation_output_imports imported
        WHERE imported.series_id IN (SELECT id FROM source_series) AND imported.deleted_at IS NULL
      UNION SELECT version.series_id, run.result_asset_id FROM generation_runs run
        JOIN prompt_versions version ON version.id = run.prompt_version_id
        WHERE version.series_id IN (SELECT id FROM source_series) AND run.status = 'SUCCEEDED'
          AND run.result_asset_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM generation_output_reviews review WHERE review.generation_run_id = run.id AND review.disposition = 'FAILED')
      UNION SELECT document.series_id, run.output_asset_id FROM gif_export_runs run
        JOIN gif_documents document ON document.id = run.document_id
        WHERE document.series_id IN (SELECT id FROM source_series) AND run.state = 'SUCCEEDED'
      UNION SELECT series_id, output_asset_id FROM image_transform_runs
        WHERE series_id IN (SELECT id FROM source_series) AND deleted_at IS NULL
    ) output WHERE output.image_asset_id IN (SELECT id FROM image_assets WHERE deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM prompt_series_output_exclusions exclusion
        WHERE exclusion.series_id = output.series_id AND exclusion.image_asset_id = output.image_asset_id)
    LIMIT 4001`,
      )
      .all({ source: id }) as { image_asset_id: string }[];
    const imported = new Map(
      (
        this.db
          .prepare(
            `${sourceSeries} SELECT * FROM creation_output_imports
             WHERE series_id IN (SELECT id FROM source_series) AND deleted_at IS NULL ORDER BY sort_order, id LIMIT 4001`,
          )
          .all({ source: id }) as Row[]
      ).map((entry) => [String(entry.image_asset_id), entry]),
    );
    outputs.sort(
      (a, b) =>
        Number(imported.get(a.image_asset_id)?.sort_order ?? Number.MAX_SAFE_INTEGER) -
        Number(imported.get(b.image_asset_id)?.sort_order ?? Number.MAX_SAFE_INTEGER),
    );
    const batch = ulid();
    const copiedImports = new Map<string, string>();
    for (const [index, output] of outputs.entries()) {
      const previous = imported.get(output.image_asset_id);
      const outputId = ulid();
      if (previous) copiedImports.set(String(previous.id), outputId);
      this.insert('creation_output_imports', {
        ...previous,
        id: outputId,
        batch_id: batch,
        series_id: next,
        prompt_version_id: versionId,
        image_asset_id: output.image_asset_id,
        source_type: previous?.source_type ?? 'DROP',
        original_name: previous?.original_name ?? output.image_asset_id,
        relationship_kind: 'UNSPECIFIED',
        relationship_target_output_id: null,
        created_at: this.timestamp,
        sort_order: index,
      });
      this.repositories.storage.recordChange('CREATION_OUTPUT_IMPORT', outputId, 'CREATE', {
        batchId: batch,
        seriesId: next,
        imageAssetId: output.image_asset_id,
        sortOrder: index,
      });
    }
    for (const previous of imported.values()) {
      const outputId = copiedImports.get(String(previous.id));
      const targetId = copiedImports.get(String(previous.relationship_target_output_id));
      if (outputId && (previous.relationship_kind === 'PRIMARY' || targetId))
        this.db
          .prepare(
            'UPDATE creation_output_imports SET relationship_kind = ?, relationship_target_output_id = ? WHERE id = ?',
          )
          .run(previous.relationship_kind, targetId ?? null, outputId);
    }
    const copiedSource = version && copiedImports.get(String(version.source_import_id));
    if (copiedSource)
      this.db.prepare('UPDATE prompt_versions SET source_import_id = ? WHERE id = ?').run(copiedSource, versionId);
  }

  private video(id: string) {
    const next = this.identity(id);
    this.insert('documents', this.row('documents', id), { id: next });
    this.children('document_source_relations', 'document_id', id, next);
    this.children('document_thumbnails', 'document_id', id, next);
    const branches = this.db
      .prepare('SELECT * FROM document_branches WHERE document_id = ? AND deleted_at IS NULL')
      .all(id) as Row[];
    for (const branch of branches) {
      const branchId = this.identity(String(branch.id));
      const draft = this.db
        .prepare('SELECT * FROM document_drafts WHERE branch_id = ? AND deleted_at IS NULL')
        .get(branch.id) as Row;
      if (!draft) throw new Error('COPY_SOURCE_UNAVAILABLE');
      const draftId = this.identity(String(draft.id));
      const revision = this.db
        .prepare('SELECT * FROM document_draft_revisions WHERE draft_id = ? ORDER BY revision_no DESC LIMIT 1')
        .get(draft.id) as Row | undefined;
      this.insert('document_branches', branch, {
        id: branchId,
        document_id: next,
        status: revision ? 'EDITABLE' : 'EMPTY',
      });
      this.insert('document_drafts', draft, { id: draftId, branch_id: branchId });
      if (revision) {
        const content = JSON.stringify(this.copyDocument(JSON.parse(String(revision.content_json))));
        this.insert('document_draft_revisions', revision, {
          id: this.identity(String(revision.id)),
          draft_id: draftId,
          parent_revision_id: null,
          revision_no: 1,
          content_json: content,
          content_hash: digest(content),
          origin: 'HUMAN',
        });
      }
    }
  }

  private visual(id: string, albumId: string | null) {
    const row = this.row('derived_visuals', id);
    const article = row.article_id ? this.entity({ kind: 'ARTICLE', id: String(row.article_id) }, albumId) : null;
    const post = row.social_post_id
      ? this.entity({ kind: 'SOCIAL_POST', id: String(row.social_post_id) }, albumId)
      : null;
    const parent = article ? this.row('articles', article) : this.row('social_post_drafts', post!);
    const draft = this.row('creation_drafts', String(row.creation_draft_id));
    const draftId = this.identity(String(draft.id));
    const series = row.prompt_series_id
      ? this.entity({ kind: 'PROMPT_SERIES', id: String(row.prompt_series_id) }, albumId)
      : null;
    this.insert('creation_drafts', draft, {
      id: draftId,
      source_series_id: series,
      target_album_id: albumId,
      consumed_at: null,
    });
    this.children('creation_draft_materials', 'creation_draft_id', String(draft.id), draftId);
    let positionId: string | null = null;
    if (row.position_id) {
      const position = this.row('article_visual_positions', String(row.position_id));
      positionId = this.identity(String(position.id));
      if (!this.db.prepare('SELECT 1 FROM article_visual_positions WHERE id = ?').get(positionId))
        this.insert('article_visual_positions', position, {
          id: positionId,
          article_id: article,
          source_revision_id: parent.current_revision_id,
          anchor_json: this.reboundAnchor(position.anchor_json),
        });
    }
    this.insert('derived_visuals', row, {
      id: this.identity(id),
      article_id: article,
      article_revision_id: article ? parent.current_revision_id : null,
      social_post_id: post,
      social_post_revision_id: post ? parent.current_revision_id : null,
      creation_draft_id: draftId,
      prompt_series_id: series,
      position_id: positionId,
      adopted_at: null,
      anchor_json: this.reboundAnchor(row.anchor_json),
    });
  }
}
