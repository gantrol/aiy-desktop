import { randomUUID } from 'node:crypto';
import type { AssetDto } from '@/shared/contracts';
import {
  gifAssetIds,
  gifManifestSchema,
  gifPlaybackFrames,
  gifWorkspaceStateSchema,
  type GifWorkspaceState,
  type GifDocument,
  type GifDocumentDetail,
  type GifDocumentSummary,
  type GifExportInput,
  type GifExportResult,
  type GifSaveInput,
} from '@/shared/contracts/gif-making';
import type { LibraryStorage, StoredObject } from '@/main/database/core/storage';
import { mediaUrl, now, text, type JsonMap } from '@/main/database/core/values';
import { ensureImageMaterials } from '@/main/database/albums/image-material-batch';
import { CreationItemRepository } from '@/main/database/creations/creation-item-repository';
import {
  gifDocumentPurposeSchema,
  gifMotionDraftSchema,
  type GifDocumentPurpose,
} from '@/shared/contracts/gif-motion-draft';

export class GifDocumentRepository {
  constructor(private readonly storage: LibraryStorage) {}
  private get db() {
    return this.storage.db;
  }
  assertAvailable(id: string) {
    const available = this.db
      .prepare(
        `SELECT 1 FROM gif_documents document
        WHERE document.id=? AND document.deleted_at IS NULL AND document.archived_at IS NULL
          AND (document.purpose='GIF' OR EXISTS (
            SELECT 1 FROM gif_documents editor
            JOIN gif_document_revisions revision ON revision.document_id=editor.id AND revision.revision=editor.revision
            WHERE editor.purpose='GIF' AND editor.deleted_at IS NULL AND editor.archived_at IS NULL
              AND json_extract(revision.manifest_json,'$.motionDocumentId')=document.id
          ))`,
      )
      .get(id);
    if (!available) throw new Error('GIF_ASSET_UNAVAILABLE');
  }
  saveWorkspace(id: string, state: GifWorkspaceState) {
    if (
      !this.db
        .prepare(
          "SELECT 1 FROM gif_documents WHERE id=? AND purpose='GIF' AND deleted_at IS NULL AND archived_at IS NULL",
        )
        .get(id)
    )
      throw new Error('GIF_ASSET_UNAVAILABLE');
    this.db
      .prepare(
        'INSERT INTO gif_workspace_state(document_id,state_json) VALUES (?,?) ON CONFLICT(document_id) DO UPDATE SET state_json=excluded.state_json',
      )
      .run(id, JSON.stringify(gifWorkspaceStateSchema.parse(state)));
  }
  list(seriesId: string | null | undefined, purpose: GifDocumentPurpose = 'GIF'): GifDocumentSummary[] {
    const rows = this.db
      .prepare(
        `SELECT d.*, COALESCE(workspace.state_json,
          json_object('step',CASE WHEN json_array_length(r.manifest_json,'$.frames')>0 THEN 'edit' ELSE 'generate' END)) AS workspace_json,
          COALESCE(
            (SELECT output_asset_id FROM gif_export_runs WHERE document_id=d.id AND state='SUCCEEDED' ORDER BY created_at DESC LIMIT 1),
            json_extract(r.manifest_json,'$.frames[0].assetId'),
            (SELECT json_extract(m.manifest_json,'$.frames[0].assetId') FROM gif_documents motion
              JOIN gif_document_revisions m ON m.document_id=motion.id AND m.revision=motion.revision
              WHERE motion.id=json_extract(r.manifest_json,'$.motionDocumentId'))
          ) AS preview_asset_id
          FROM gif_documents d JOIN gif_document_revisions r ON r.document_id=d.id AND r.revision=d.revision
          LEFT JOIN gif_workspace_state workspace ON workspace.document_id=d.id
          WHERE (? OR d.series_id IS ?) AND d.purpose=? AND d.deleted_at IS NULL AND d.archived_at IS NULL
          ORDER BY d.updated_at DESC LIMIT 1000`,
      )
      .all(seriesId === undefined ? 1 : 0, seriesId ?? null, purpose) as JsonMap[];
    const assets = new Map(
      this.assets([...new Set(rows.flatMap((row) => (row.preview_asset_id ? [text(row.preview_asset_id)] : [])))]).map(
        (asset) => [asset.id, asset],
      ),
    );
    return rows.map((row) => ({
      workspace: gifWorkspaceStateSchema.parse(JSON.parse(text(row.workspace_json))),
      seriesId: row.series_id ? text(row.series_id) : null,
      preview: assets.get(text(row.preview_asset_id)) ?? null,
      id: text(row.id),
      purpose,
      title: text(row.title),
      revision: Number(row.revision),
      updatedAt: text(row.updated_at),
    }));
  }
  load(id: string, revision?: number): GifDocumentDetail {
    const row = this.db
      .prepare(
        `SELECT d.*, r.revision AS saved_revision, r.manifest_json, r.motion_draft_json
      FROM gif_documents d JOIN gif_document_revisions r ON r.document_id=d.id AND r.revision=COALESCE(?,d.revision)
      WHERE d.id=? AND d.deleted_at IS NULL AND d.archived_at IS NULL`,
      )
      .get(revision ?? null, id) as JsonMap | undefined;
    if (!row) throw new Error('GIF_ASSET_UNAVAILABLE');
    if (row.purpose === 'MOTION') this.assertAvailable(id);
    const manifest = gifManifestSchema.parse(JSON.parse(text(row.manifest_json)));
    const assets = this.assets(gifAssetIds(manifest));
    const workspaceJson = this.db
      .prepare('SELECT state_json FROM gif_workspace_state WHERE document_id=?')
      .pluck()
      .get(id) as string | undefined;
    const exported = this.db
      .prepare(
        `SELECT e.id,e.revision,e.output_asset_id,r.manifest_json FROM gif_export_runs e
      JOIN gif_document_revisions r ON r.document_id=e.document_id AND r.revision=e.revision
      JOIN image_assets asset ON asset.id=e.output_asset_id AND asset.deleted_at IS NULL
      WHERE e.document_id=? AND e.state='SUCCEEDED' ORDER BY e.created_at DESC,e.rowid DESC LIMIT 1`,
      )
      .get(id) as JsonMap | undefined;
    const exportedAsset = exported ? this.assets([text(exported.output_asset_id)])[0] : undefined;
    const exportedManifest = exported ? gifManifestSchema.safeParse(JSON.parse(text(exported.manifest_json))) : null;
    const exportedFrames = exportedManifest?.success ? gifPlaybackFrames(exportedManifest.data) : [];
    return {
      ...(workspaceJson ? { workspace: gifWorkspaceStateSchema.parse(JSON.parse(workspaceJson)) } : {}),
      ...(exportedAsset && exported
        ? {
            latestExport: {
              runId: text(exported.id),
              documentId: id,
              revision: Number(exported.revision),
              asset: exportedAsset,
              durationMs: exportedFrames.reduce((sum, frame) => sum + frame.durationMs, 0),
              frameCount: exportedFrames.length,
            },
          }
        : {}),
      document: {
        purpose: gifDocumentPurposeSchema.parse(row.purpose),
        motionDraft: row.motion_draft_json ? gifMotionDraftSchema.parse(JSON.parse(text(row.motion_draft_json))) : null,
        id,
        seriesId: row.series_id ? text(row.series_id) : null,
        title: text(row.title),
        revision: Number(row.saved_revision),
        manifest,
        updatedAt: text(row.updated_at),
      },
      assets,
    };
  }
  assets(ids: string[]): AssetDto[] {
    if (!ids.length) return [];
    return (
      this.db
        .prepare(`SELECT * FROM image_assets WHERE id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL`)
        .all(...ids) as JsonMap[]
    ).map((row) => this.asset(row));
  }
  private asset(row: JsonMap): AssetDto {
    return {
      id: text(row.id),
      kind: text(row.kind) === 'REFERENCE' ? 'REFERENCE' : 'GENERATED',
      originType: text(row.origin_type),
      width: Number(row.width),
      height: Number(row.height),
      mimeType: text(row.mime_type),
      byteSize: Number(row.byte_size),
      mediaUrl: mediaUrl(text(row.id)),
      createdAt: text(row.created_at),
    };
  }
  save(input: GifSaveInput, owner: { sourceDocumentId?: string; targetAlbumId?: string | null } = {}): GifDocument {
    return this.db
      .transaction(() => {
        const previous = this.db
          .prepare('SELECT revision, series_id, purpose, deleted_at, archived_at FROM gif_documents WHERE id=?')
          .get(input.id) as JsonMap | undefined;
        if (
          previous?.deleted_at ||
          previous?.archived_at ||
          Number(previous?.revision ?? 0) !== input.expectedRevision ||
          (previous && ((previous.series_id ?? null) !== input.seriesId || previous.purpose !== input.purpose))
        )
          throw new Error('GIF_CONFLICT');
        if (previous?.purpose === 'MOTION') this.assertAvailable(input.id);
        if (input.seriesId && !this.db.prepare('SELECT 1 FROM prompt_series WHERE id=?').get(input.seriesId))
          throw new Error('GIF_ASSET_UNAVAILABLE');
        const ids = gifAssetIds(input.manifest);
        if (this.assets(ids).length !== ids.length) throw new Error('GIF_ASSET_UNAVAILABLE');
        const revision = input.expectedRevision + 1;
        const updatedAt = now();
        this.db
          .prepare(
            `INSERT INTO gif_documents(id,series_id,title,revision,updated_at,purpose) VALUES (?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, revision=excluded.revision, updated_at=excluded.updated_at`,
          )
          .run(input.id, input.seriesId, input.title, revision, updatedAt, input.purpose);
        this.db
          .prepare(
            'INSERT INTO gif_document_revisions(document_id,revision,manifest_json,created_at,motion_draft_json) VALUES (?,?,?,?,?)',
          )
          .run(
            input.id,
            revision,
            JSON.stringify(input.manifest),
            updatedAt,
            input.motionDraft ? JSON.stringify(input.motionDraft) : null,
          );
        const insert = this.db.prepare('INSERT INTO gif_document_assets VALUES (?,?,?)');
        for (const id of ids) insert.run(input.id, revision, id);
        if (input.purpose === 'GIF') {
          const creations = new CreationItemRepository(this.storage);
          const entity = { kind: 'GIF_DOCUMENT' as const, id: input.id };
          if (!previous) {
            const sourceForm = owner.sourceDocumentId
              ? this.copySourceForm(owner.sourceDocumentId)
              : input.seriesId
                ? creations.findSourceFormForImageSeries(input.seriesId)
                : undefined;
            if (sourceForm)
              // Each new GIF or copy adds an animation form while preserving its source lineage.
              creations.addForm({
                creationItemId: sourceForm.creationItemId,
                sourceFormId: sourceForm.id,
                role: 'ANIMATION',
                entity,
                anchorKey: null,
              });
            else
              creations.createWithForm({
                albumId: owner.targetAlbumId ?? null,
                form: { role: 'ANIMATION', entity, anchorKey: null },
              });
          } else creations.touchForEntity(entity, updatedAt);
        }
        this.storage.recordChange('GIF_DOCUMENT', input.id, 'SAVE', { revision });
        return {
          purpose: input.purpose,
          motionDraft: input.motionDraft,
          id: input.id,
          seriesId: input.seriesId,
          title: input.title,
          revision,
          manifest: input.manifest,
          updatedAt,
        };
      })
      .immediate();
  }
  private copySourceForm(documentId: string) {
    const { document } = this.load(documentId);
    if (document.purpose !== 'GIF') throw new Error('GIF_INVALID');
    const row = this.db
      .prepare(
        `SELECT form.id,form.creation_item_id FROM creation_forms form
      JOIN creation_items item ON item.id=form.creation_item_id AND item.deleted_at IS NULL AND item.archived_at IS NULL
      WHERE form.entity_type='GIF_DOCUMENT' AND form.entity_id=? AND form.deleted_at IS NULL`,
      )
      .get(documentId) as { id: string; creation_item_id: string } | undefined;
    if (!row) throw new Error('GIF_ASSET_UNAVAILABLE');
    return { id: row.id, creationItemId: row.creation_item_id };
  }
  findForAsset(assetId: string, purpose: GifDocumentPurpose = 'GIF', seriesId: string | null = null) {
    if (purpose === 'MOTION') {
      const source = this.db
        .prepare(
          `SELECT d.id FROM gif_documents d
        JOIN gif_document_assets a ON a.document_id=d.id AND a.revision=d.revision
        WHERE a.asset_id=? AND d.purpose='MOTION' AND d.series_id IS ? AND d.deleted_at IS NULL AND d.archived_at IS NULL
        ORDER BY d.updated_at DESC LIMIT 1`,
        )
        .get(assetId, seriesId) as JsonMap | undefined;
      return source ? text(source.id) : null;
    }
    const row = this.db
      .prepare(
        `SELECT e.document_id,0 AS priority,e.created_at AS resume_at FROM gif_export_runs e JOIN gif_documents d ON d.id=e.document_id
          WHERE e.output_asset_id=? AND e.state='SUCCEEDED' AND d.deleted_at IS NULL AND d.archived_at IS NULL
          UNION ALL SELECT d.id,1,d.updated_at FROM gif_documents d
          JOIN gif_document_revisions r ON r.document_id=d.id AND r.revision=d.revision
          JOIN gif_documents motion ON motion.id=json_extract(r.manifest_json,'$.motionDocumentId')
          JOIN gif_document_assets source ON source.document_id=motion.id AND source.revision=motion.revision
          WHERE source.asset_id=? AND d.series_id IS ? AND d.purpose='GIF' AND d.deleted_at IS NULL AND d.archived_at IS NULL
          ORDER BY priority,resume_at DESC,document_id LIMIT 1`,
      )
      .get(assetId, assetId, seriesId) as JsonMap | undefined;
    return row ? text(row.document_id) : null;
  }
  begin(input: GifExportInput) {
    const existing = this.db.prepare('SELECT id FROM gif_export_runs WHERE id=?').get(input.runId);
    if (existing) throw new Error('GIF_CONFLICT');
    this.db
      .prepare(
        `INSERT INTO gif_export_runs(id,document_id,revision,state,encoder,created_at)
      VALUES (?,?,?,'RUNNING','gifenc@1.0.3/global-rgb565-v1',?)`,
      )
      .run(input.runId, input.documentId, input.revision, now());
  }
  fail(runId: string, code: string) {
    this.db
      .prepare(`UPDATE gif_export_runs SET state=?,error_code=? WHERE id=? AND state='RUNNING'`)
      .run(code === 'GIF_CANCELLED' ? 'CANCELLED' : 'FAILED', code, runId);
  }
  finish(input: GifExportInput, stored: StoredObject): GifExportResult {
    return this.db
      .transaction(() => {
        const { document } = this.load(input.documentId, input.revision);
        if (!this.db.prepare(`SELECT 1 FROM gif_export_runs WHERE id=? AND state='RUNNING'`).get(input.runId))
          throw new Error('GIF_CANCELLED');
        const id = randomUUID();
        const createdAt = now();
        this.db
          .prepare(
            `INSERT INTO image_assets(id,kind,origin_type,object_hash,relative_path,width,height,mime_type,byte_size,created_at,deleted_at)
        VALUES (?,'GENERATED','LOCAL_GIF',?,?,?,?,'image/gif',?,?,NULL)`,
          )
          .run(id, stored.hash, stored.relativePath, stored.width, stored.height, stored.byteSize, createdAt);
        const derive = this.db
          .prepare(`INSERT INTO asset_derivations(id,child_asset_id,source_asset_id,relation_type,generation_run_id,created_at)
        VALUES (?,?,?,'LOCAL_GIF',NULL,?)`);
        for (const assetId of gifAssetIds(document.manifest)) derive.run(randomUUID(), id, assetId, createdAt);
        this.db
          .prepare(`UPDATE gif_export_runs SET state='SUCCEEDED',output_asset_id=? WHERE id=?`)
          .run(id, input.runId);
        ensureImageMaterials(this.storage, [id]);
        this.storage.recordChange('IMAGE_ASSET', id, 'CREATE', {
          originType: 'LOCAL_GIF',
          documentId: input.documentId,
          revision: input.revision,
        });
        const frames = gifPlaybackFrames(document.manifest);
        return {
          ...input,
          asset: {
            id,
            kind: 'GENERATED' as const,
            originType: 'LOCAL_GIF',
            width: stored.width,
            height: stored.height,
            mimeType: 'image/gif',
            byteSize: stored.byteSize,
            mediaUrl: mediaUrl(id),
            createdAt,
          },
          durationMs: frames.reduce((sum, frame) => sum + frame.durationMs, 0),
          frameCount: frames.length,
        };
      })
      .immediate();
  }
}
