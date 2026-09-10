import { randomUUID } from 'node:crypto';
import { gifFrameAuditSchema, type GifFrameAudit } from '@/shared/contracts/gif-motion-plan';
import type { LibraryStorage, StoredObject } from '@/main/database/core/storage';
import { now, text, type JsonMap } from '@/main/database/core/values';
import { GifDocumentRepository } from '@/main/database/creations/gif-document-repository';
import { gifAssetIds, gifManifestSchema, type GifManifest } from '@/shared/contracts/gif-making';
import {
  gifGenerationSettingsSchema,
  type GifGenerationStart,
  type GifGenerationState,
  type GifGenerationCandidate,
  type GifGenerationAdopt,
} from '@/shared/contracts/gif-generation';

export class GifGenerationRepository {
  private readonly documents;
  constructor(private readonly storage: LibraryStorage) {
    this.documents = new GifDocumentRepository(storage);
  }
  private get db() {
    return this.storage.db;
  }
  begin(input: GifGenerationStart) {
    return this.db
      .transaction(() => {
        const { document } = this.documents.load(input.documentId);
        if (document.purpose !== 'MOTION') throw new Error('GIF_INVALID');
        if (document.revision !== input.expectedRevision) throw new Error('GIF_CONFLICT');
        if (!gifAssetIds(document.manifest).includes(input.settings.sourceAssetId))
          throw new Error('GIF_ASSET_UNAVAILABLE');
        this.db
          .prepare(
            `INSERT INTO gif_generation_runs(id,document_id,revision,settings_json,state,created_at) VALUES (?,?,?,?,'PREPARING',?)`,
          )
          .run(input.id, input.documentId, input.expectedRevision, JSON.stringify(input.settings), now());
        this.reference(input.id, input.settings.sourceAssetId);
        return this.load(input.id);
      })
      .immediate();
  }
  reference(id: string, assetId: string) {
    this.db.prepare('INSERT OR IGNORE INTO gif_generation_assets(run_id,asset_id) VALUES (?,?)').run(id, assetId);
  }
  update(
    id: string,
    state: GifGenerationState,
    options: { generationRunId?: string; manifest?: GifManifest; errorCode?: string; audit?: GifFrameAudit } = {},
  ) {
    this.db
      .prepare(
        `UPDATE gif_generation_runs SET state=?,generation_run_id=COALESCE(?,generation_run_id),manifest_json=COALESCE(?,manifest_json),error_code=?,audit_json=COALESCE(?,audit_json) WHERE id=? AND state IN ('PREPARING','GENERATING','COMPOSITING')`,
      )
      .run(
        state,
        options.generationRunId ?? null,
        options.manifest ? JSON.stringify(options.manifest) : null,
        options.errorCode ?? null,
        options.audit ? JSON.stringify(options.audit) : null,
        id,
      );
  }
  latest(documentId: string) {
    this.documents.assertAvailable(documentId);
    const row = this.db
      .prepare('SELECT id FROM gif_generation_runs WHERE document_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1')
      .get(documentId) as JsonMap | undefined;
    return row ? this.load(text(row.id)) : null;
  }
  history(documentId: string) {
    this.documents.assertAvailable(documentId);
    const rows = this.db
      .prepare(
        "SELECT id FROM gif_generation_runs WHERE document_id=? AND manifest_json IS NOT NULL AND state IN ('READY','ADOPTED') ORDER BY created_at DESC,rowid DESC LIMIT 20",
      )
      .all(documentId) as JsonMap[];
    return rows.map((row) => this.load(text(row.id)));
  }
  load(id: string): GifGenerationCandidate {
    const row = this.db
      .prepare(
        'SELECT r.*, g.error_message AS provider_message FROM gif_generation_runs r LEFT JOIN generation_runs g ON g.id=r.generation_run_id WHERE r.id=?',
      )
      .get(id) as JsonMap | undefined;
    if (!row) throw new Error('GIF_ASSET_UNAVAILABLE');
    const manifest = row.manifest_json ? gifManifestSchema.parse(JSON.parse(text(row.manifest_json))) : null;
    return {
      id,
      documentId: text(row.document_id),
      revision: Number(row.revision),
      settings: gifGenerationSettingsSchema.parse(JSON.parse(text(row.settings_json))),
      state: text(row.state) as GifGenerationState,
      generationRunId: row.generation_run_id ? text(row.generation_run_id) : null,
      errorCode: row.error_code ? text(row.error_code) : null,
      providerMessage: row.provider_message ? text(row.provider_message).slice(0, 4000) : null,
      manifest,
      assets: manifest ? this.documents.assets(gifAssetIds(manifest)) : [],
      createdAt: text(row.created_at),
      audit: row.audit_json ? gifFrameAuditSchema.parse(JSON.parse(text(row.audit_json))) : null,
    };
  }
  modelResult(runId: string) {
    const row = this.db
      .prepare('SELECT status,result_asset_id,error_code FROM generation_runs WHERE id=?')
      .get(runId) as JsonMap | undefined;
    return row
      ? {
          status: text(row.status),
          assetId: row.result_asset_id ? text(row.result_asset_id) : null,
          errorCode: row.error_code ? text(row.error_code) : null,
        }
      : null;
  }
  storeAsset(id: string, stored: StoredObject, sources: string[], generationRunId?: string) {
    return this.db
      .transaction(() => {
        const run = this.load(id);
        if (!['PREPARING', 'GENERATING', 'COMPOSITING'].includes(run.state)) throw new Error('GIF_CANCELLED');
        const assetId = randomUUID(),
          createdAt = now();
        this.db
          .prepare(
            `INSERT INTO image_assets(id,kind,origin_type,object_hash,relative_path,width,height,mime_type,byte_size,created_at,deleted_at) VALUES (?,'GENERATED','LOCAL_GIF_FRAME',?,?,?,?,'image/png',?,?,NULL)`,
          )
          .run(assetId, stored.hash, stored.relativePath, stored.width, stored.height, stored.byteSize, createdAt);
        for (const source of new Set(sources))
          this.db
            .prepare(
              `INSERT INTO asset_derivations(id,child_asset_id,source_asset_id,relation_type,generation_run_id,created_at) VALUES (?,?,?,'GIF_FRAME',?,?)`,
            )
            .run(randomUUID(), assetId, source, generationRunId ?? run.generationRunId, createdAt);
        this.reference(id, assetId);
        this.storage.recordChange('IMAGE_ASSET', assetId, 'CREATE', { originType: 'LOCAL_GIF_FRAME' });
        return this.documents.assets([assetId])[0];
      })
      .immediate();
  }
  adopt(input: GifGenerationAdopt) {
    return this.db
      .transaction(() => {
        const candidate = this.load(input.id);
        const { document } = this.documents.load(input.documentId);
        const source = this.documents.load(candidate.documentId).document;
        if (
          !['READY', 'ADOPTED'].includes(candidate.state) ||
          !candidate.manifest ||
          document.purpose !== 'GIF' ||
          document.manifest.motionDocumentId !== candidate.documentId ||
          source.seriesId !== document.seriesId
        )
          throw new Error('GIF_INVALID');
        if (document.revision !== input.expectedRevision) throw new Error('GIF_CONFLICT');
        if (document.manifest.generationId === candidate.id) return this.documents.load(document.id);
        this.documents.save({
          purpose: 'GIF',
          motionDraft: null,
          id: document.id,
          seriesId: document.seriesId,
          title: document.title,
          expectedRevision: document.revision,
          manifest: { ...candidate.manifest, motionDocumentId: candidate.documentId, generationId: candidate.id },
        });
        return this.documents.load(document.id);
      })
      .immediate();
  }
}
