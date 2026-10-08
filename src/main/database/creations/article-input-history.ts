import type { LibraryStorage } from '@/main/database/core/storage';
import { mediaUrl, text, type JsonMap } from '@/main/database/core/values';
import type { IntakeRepository } from '@/main/database/creations/intake-repository';
import type { CreatorAgentAssistInput, CreationInputSnapshotInput } from '@/shared/contracts';
import { creationVideoAttachments } from '@/main/database/creations/creation-video-attachments';
import {
  decodeCreatorAgentRequest,
  MAX_CREATOR_AGENT_REQUEST_BYTES,
} from '@/main/database/assistant/creator-agent-persistence';
import { CreationItemRepository } from '@/main/database/creations/creation-item-repository';
import { emptyAlbumCreationDefaults } from '@/shared/album-creation-defaults';
import {
  articleInputHistoryPageSchema,
  articleInputRecordSchema,
  articleInputSnapshotSchema,
  articleInputDraftSnapshotSchema,
  type ArticleInputHistoryQuery,
  type ArticleInputRecordQuery,
  type ArticleInputContinueQuery,
  type ArticleInputSnapshot,
} from '@/shared/contracts/article-input-history';

// Consumption records bind a frozen draft to the article that actually used it.
// A source form or today's article body is not evidence of the input used then.
const sourceRecords = `WITH source_drafts AS (
  SELECT DISTINCT entity_id AS id FROM change_events
  WHERE entity_type = 'CREATION_DRAFT' AND operation = 'CONSUME_ARTICLE'
    AND json_valid(payload_json) AND json_extract(payload_json, '$.articleId') = ?
), records AS (
  SELECT 'CREATION:' || draft.id AS id, 'CREATION' AS kind, draft.id AS source_id,
    draft.consumed_at AS created_at FROM creation_drafts draft
    JOIN source_drafts source ON source.id = draft.id
    WHERE draft.consumed_at IS NOT NULL AND draft.deleted_at IS NULL
  UNION ALL
  SELECT 'STASH:' || stash.id, 'STASH', stash.id, stash.created_at
    FROM creation_input_stashes stash JOIN source_drafts source ON source.id = stash.scope_id
    WHERE stash.scope_kind = 'DRAFT'
  UNION ALL
  SELECT 'WRITING:' || turn.id, 'WRITING', turn.id, turn.created_at
    FROM creator_agent_turns turn JOIN source_drafts source ON source.id = turn.scope_id
    WHERE turn.scope_kind = 'DRAFT'
  UNION ALL
  SELECT 'ASSISTANT:' || run.id, 'ASSISTANT', run.id, run.created_at
    FROM assistant_runs run JOIN source_drafts source ON source.id = run.scope_id
    WHERE run.scope_kind = 'DRAFT'
)`;

export class ArticleInputHistoryRepository {
  constructor(
    private readonly storage: LibraryStorage,
    private readonly intake: IntakeRepository,
  ) {}

  private article(articleId: string) {
    const row = this.storage.db
      .prepare('SELECT id, album_id FROM articles WHERE id = ? AND deleted_at IS NULL')
      .get(articleId) as JsonMap | undefined;
    if (!row) throw new Error('ARTICLE_INPUT_UNAVAILABLE');
    return row;
  }

  list(input: ArticleInputHistoryQuery) {
    this.article(input.articleId);
    const cursor = input.cursor;
    const rows = this.storage.db
      .prepare(
        `${sourceRecords}
      SELECT id, kind, created_at FROM records
      ${cursor ? 'WHERE (created_at, id) > (?, ?)' : ''}
      ORDER BY created_at, id LIMIT 21`,
      )
      .all(input.articleId, ...(cursor ? [cursor.createdAt, cursor.id] : [])) as JsonMap[];
    const items = rows.slice(0, 20).map((row) => ({ id: row.id, kind: row.kind, createdAt: row.created_at }));
    const last = items.at(-1);
    return articleInputHistoryPageSchema.parse({
      spaceId: input.spaceId,
      articleId: input.articleId,
      items,
      nextCursor: rows.length > 20 && last ? { createdAt: last.createdAt, id: last.id } : null,
    });
  }

  get(input: ArticleInputRecordQuery) {
    this.article(input.articleId);
    const record = this.storage.db
      .prepare(`${sourceRecords} SELECT * FROM records WHERE id = ?`)
      .get(input.articleId, input.recordId) as JsonMap | undefined;
    if (!record) throw new Error('ARTICLE_INPUT_UNAVAILABLE');
    const sourceId = text(record.source_id);
    const detail =
      record.kind === 'CREATION'
        ? this.creation(sourceId)
        : record.kind === 'STASH'
          ? this.stash(sourceId)
          : record.kind === 'WRITING'
            ? this.writing(sourceId)
            : this.assistant(sourceId);
    const snapshot = articleInputSnapshotSchema.parse(detail.snapshot);
    const referenceAssets = this.assets(snapshot.referenceAssetIds);
    const videoAttachments = detail.videoAttachments ?? [];
    const available = new Set([
      ...referenceAssets.map((asset) => asset.id),
      ...videoAttachments.map((video) => video.materialId),
    ]);
    return articleInputRecordSchema.parse({
      spaceId: input.spaceId,
      articleId: input.articleId,
      id: record.id,
      kind: record.kind,
      createdAt: record.created_at,
      ...detail,
      snapshot,
      referenceAssets,
      videoAttachments,
      canContinue: articleInputDraftSnapshotSchema.safeParse(snapshot).success,
      missingReferenceIds: [...snapshot.referenceAssetIds, ...snapshot.videoMaterialIds].filter(
        (id) => !available.has(id),
      ),
    });
  }

  private creation(id: string) {
    const draft = this.intake.getDraft(id);
    const links = this.storage.db
      .prepare(
        `SELECT material.image_asset_id, link.material_id, link.role
      FROM creation_draft_materials link JOIN materials material ON material.id = link.material_id
      WHERE link.creation_draft_id = ? ORDER BY link.sort_order, link.id`,
      )
      .all(id) as JsonMap[];
    return {
      snapshot: articleInputSnapshotSchema.strip().parse({
        ...draft,
        referenceAssetIds: links
          .filter((row) => row.role === 'REFERENCE' && row.image_asset_id)
          .map((row) => text(row.image_asset_id)),
        videoMaterialIds: links.filter((row) => row.role === 'ATTACHMENT').map((row) => text(row.material_id)),
      }),
      selectionText: null,
      videoAttachments: draft.videoAttachments,
      requestDetails: null,
    };
  }

  private writing(id: string) {
    const row = this.storage.db
      .prepare(
        `SELECT request_json FROM creator_agent_turns
      WHERE id = ? AND length(CAST(request_json AS BLOB)) <= ?`,
      )
      .get(id, MAX_CREATOR_AGENT_REQUEST_BYTES) as JsonMap | undefined;
    if (!row) throw new Error('ARTICLE_INPUT_UNAVAILABLE');
    const request = decodeCreatorAgentRequest(text(row.request_json), id);
    return {
      snapshot: {
        text: request.prompt,
        document: request.documentTask?.baseDocument,
        writingInstruction: request.message,
        startMode: request.documentTask
          ? request.documentTask.kind === 'outline'
            ? 'outline'
            : 'manuscript'
          : 'image',
        referenceAssetIds: request.attachmentAssetIds,
        videoMaterialIds: [],
      },
      selectionText: request.documentTask?.selection?.text ?? null,
      videoAttachments: [],
      requestDetails: null,
    };
  }

  private stash(id: string) {
    const row = this.storage.db
      .prepare(
        `SELECT input_json FROM creation_input_stashes
      WHERE id = ? AND length(CAST(input_json AS BLOB)) <= ?`,
      )
      .get(id, MAX_CREATOR_AGENT_REQUEST_BYTES) as JsonMap | undefined;
    if (!row) throw new Error('ARTICLE_INPUT_UNAVAILABLE');
    const input = JSON.parse(text(row.input_json)) as CreationInputSnapshotInput;
    if (input.schemaVersion !== 1) throw new Error('ARTICLE_INPUT_UNAVAILABLE');
    const snapshot = articleInputSnapshotSchema.strip().parse({
      ...input,
      text: input.manualPrompt,
      modelTargets: input.generationTargets,
      videoMaterialIds: input.videoMaterialIds ?? [],
    });
    return {
      snapshot,
      selectionText: null,
      videoAttachments: creationVideoAttachments(this.storage.db, snapshot.videoMaterialIds),
      requestDetails: { resolvedPrompt: input.resolvedPrompt },
    };
  }

  private assistant(id: string) {
    const row = this.storage.db
      .prepare(
        `SELECT request_json, model_key FROM assistant_runs
      WHERE id = ? AND length(CAST(request_json AS BLOB)) <= ?`,
      )
      .get(id, MAX_CREATOR_AGENT_REQUEST_BYTES) as JsonMap | undefined;
    if (!row) throw new Error('ARTICLE_INPUT_UNAVAILABLE');
    const request = JSON.parse(text(row.request_json)) as CreatorAgentAssistInput;
    return {
      snapshot: {
        text: request.prompt,
        writingInstruction: request.message,
        document: request.documentTask?.baseDocument,
        startMode: 'image',
        termIds: request.directTerms?.map((term) => term.stableId),
        wordPaletteReferences: request.recipes?.map((recipe) => ({
          paletteId: recipe.stableId,
          paletteRevisionId: recipe.revisionId,
          parameterValues: recipe.parameterValues,
          promptLocale: recipe.promptLocale,
        })),
        promptNodes: request.contentNodes?.map((node) => {
          if (node.kind === 'TERM') return { kind: node.kind, termId: node.termId };
          if (node.kind === 'RECIPE') return { kind: node.kind, paletteId: node.paletteId };
          return node;
        }),
        termPromptLocale: request.termPromptLocale,
        canvasPresetKey: request.canvasPresetKey,
        modelTargets: request.generationTargets,
        referenceAssetIds: (request.referenceAssets ?? []).map((asset) => asset.assetId),
        videoMaterialIds: [],
      },
      selectionText: request.documentTask?.selection?.text ?? null,
      videoAttachments: [],
      requestDetails: {
        terms: request.directTerms ?? [],
        recipes: request.recipes ?? [],
        canvasWidth: request.canvasWidth,
        canvasHeight: request.canvasHeight,
        model: row.model_key,
        webSearchMode: request.webSearchMode,
      },
    };
  }

  private assets(ids: string[]) {
    if (!ids.length) return [];
    const rows = this.storage.db
      .prepare(
        `SELECT id, kind, origin_type, width, height, mime_type, byte_size, created_at
      FROM image_assets WHERE id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL`,
      )
      .all(...ids) as JsonMap[];
    const byId = new Map(
      rows.map((row) => [
        text(row.id),
        {
          id: text(row.id),
          kind: row.kind,
          originType: text(row.origin_type),
          width: row.width,
          height: row.height,
          mimeType: row.mime_type,
          byteSize: row.byte_size,
          createdAt: row.created_at,
          mediaUrl: mediaUrl(text(row.id)),
        },
      ]),
    );
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  continue(input: ArticleInputContinueQuery) {
    return this.storage.db
      .transaction(() => {
        const previous = this.storage.db
          .prepare(
            `SELECT entity_id FROM change_events
        WHERE entity_type = 'CREATION_DRAFT' AND operation = 'CONTINUE_ARTICLE_INPUT'
          AND json_extract(payload_json, '$.requestId') = ?
          AND json_extract(payload_json, '$.articleId') = ?
          AND json_extract(payload_json, '$.recordId') = ? LIMIT 1`,
          )
          .get(input.requestId, input.articleId, input.recordId) as JsonMap | undefined;
        if (previous) return this.intake.loadDraft(text(previous.entity_id));
        const article = this.article(input.articleId);
        const record = this.get(input);
        if (!record.canContinue) throw new Error('ARTICLE_INPUT_CONTINUE_UNAVAILABLE');
        if (record.missingReferenceIds.length) throw new Error('ARTICLE_INPUT_MEDIA_UNAVAILABLE');
        const form = this.storage.db
          .prepare(
            "SELECT id FROM creation_forms WHERE entity_type = 'ARTICLE' AND entity_id = ? AND deleted_at IS NULL",
          )
          .get(input.articleId) as JsonMap | undefined;
        if (!form) throw new Error('ARTICLE_INPUT_UNAVAILABLE');
        const sourceForm = new CreationItemRepository(this.storage).getForm(text(form.id));
        const snapshot = record.snapshot;
        const draft = this.intake.startDraft(
          {
            albumId: article.album_id ? text(article.album_id) : null,
            startMode: snapshot.startMode ?? 'manuscript',
            termPromptLocale: snapshot.termPromptLocale ?? 'en',
            creationSource: { kind: 'FORM', id: sourceForm.id },
          },
          emptyAlbumCreationDefaults(),
        );
        const saved = this.intake.saveDraft(this.continuationInput(draft, snapshot));
        this.storage.recordChange(
          'CREATION_DRAFT',
          saved.id,
          'CONTINUE_ARTICLE_INPUT',
          {
            requestId: input.requestId,
            articleId: input.articleId,
            recordId: input.recordId,
          },
          { affectsFileView: false },
        );
        return saved;
      })
      .immediate();
  }

  private continuationInput(draft: ReturnType<IntakeRepository['getDraft']>, snapshot: ArticleInputSnapshot) {
    return {
      ...snapshot,
      id: draft.id,
      expectedUpdatedAt: draft.updatedAt,
      title: '',
      targetAlbumId: draft.targetAlbumId,
      termPromptLocale: snapshot.termPromptLocale ?? draft.termPromptLocale,
      termIds: snapshot.termIds ?? [],
      wordPaletteReferences: snapshot.wordPaletteReferences ?? [],
      dictionaryScope: snapshot.dictionaryScope ?? draft.dictionaryScope,
      canvasPresetKey: snapshot.canvasPresetKey ?? null,
      quality: snapshot.quality ?? draft.quality,
      selectedModelKeys: snapshot.selectedModelKeys ?? snapshot.modelTargets?.map((target) => target.modelKey) ?? [],
      repeatCount: snapshot.repeatCount ?? 1,
      modelTargets: snapshot.modelTargets ?? [],
    };
  }
}
