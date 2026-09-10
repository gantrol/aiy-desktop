import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import { GifDocumentRepository } from '@/main/database/creations/gif-document-repository';
import {
  newGifManifest,
  type GifWorkspaceDetail,
  type GifExportInput,
  type GifSaveInput,
  type GifWorkspaceState,
  type GifWorkspaceCreateInput,
} from '@/shared/contracts/gif-making';
import { randomUUID } from 'node:crypto';
import type { StoredObject } from '@/main/database/core/storage';
import { GifGenerationRepository } from '@/main/database/creations/gif-generation-repository';
import type { GifGenerationStart, GifGenerationAdopt, GifGenerationState } from '@/shared/contracts/gif-generation';
import type { GifManifest } from '@/shared/contracts/gif-making';
import type { GifFrameAudit } from '@/shared/contracts/gif-motion-plan';
import type { GifDocumentPurpose } from '@/shared/contracts/gif-motion-draft';
import { gifExecutionSeries } from '@/main/database/creations/gif-execution-ownership';
import { ensureImageMaterials } from '@/main/database/albums/image-material-batch';

export function createGifMakingApi({
  storage,
  socialPosts,
  creationItems,
}: Pick<LibraryDatabaseRepositories, 'storage' | 'socialPosts' | 'creationItems'>) {
  const documents = new GifDocumentRepository(storage);
  const generated = new GifGenerationRepository(storage);
  return {
    assertGifDocumentAvailable: (id: string) => documents.assertAvailable(id),
    openGifWorkspace: (id: string): GifWorkspaceDetail =>
      storage.db
        .transaction(() => {
          const editor = documents.load(id);
          if (editor.document.purpose !== 'GIF') throw new Error('GIF_INVALID');
          let motionId = editor.document.manifest.motionDocumentId;
          if (!motionId) {
            // Legacy workspaces must acquire their motion draft and the link together.
            // The immediate transaction also makes concurrent opens reuse the same draft.
            const { document } = editor;
            const source = editor.assets.find((asset) => asset.id === document.manifest.frames[0]?.assetId);
            const motion = documents.save({
              id: randomUUID(),
              seriesId: document.seriesId,
              title: '',
              purpose: 'MOTION',
              motionDraft: null,
              expectedRevision: 0,
              manifest: newGifManifest(source),
            });
            motionId = motion.id;
            editor.document = documents.save({
              id: document.id,
              seriesId: document.seriesId,
              title: document.title,
              purpose: document.purpose,
              motionDraft: document.motionDraft,
              expectedRevision: document.revision,
              manifest: { ...document.manifest, motionDocumentId: motionId },
            });
          }
          const motion = documents.load(motionId);
          if (motion.document.purpose !== 'MOTION' || motion.document.seriesId !== editor.document.seriesId)
            throw new Error('GIF_INVALID');
          return { editor, motion };
        })
        .immediate(),
    createGifWorkspace: (input: GifWorkspaceCreateInput) =>
      storage.db
        .transaction(() => {
          const motion = documents.save({
            id: input.motionId,
            seriesId: input.seriesId,
            purpose: 'MOTION',
            title: input.title,
            expectedRevision: 0,
            manifest: input.motionManifest,
            motionDraft: input.motionDraft,
          });
          return documents.save(
            {
              id: input.id,
              seriesId: input.seriesId,
              purpose: 'GIF',
              title: input.title,
              expectedRevision: 0,
              manifest: { ...input.manifest, motionDocumentId: motion.id },
              motionDraft: null,
            },
            { sourceDocumentId: input.sourceDocumentId, targetAlbumId: input.targetAlbumId },
          );
        })
        .immediate(),
    gifFramesAsGroup: (documentId: string, candidateId: string): string =>
      storage.db
        .transaction(() => {
          const { document } = documents.load(documentId);
          const candidate = generated.load(candidateId);
          if (
            !candidate.manifest ||
            !['READY', 'ADOPTED'].includes(candidate.state) ||
            document.manifest.motionDocumentId !== candidate.documentId
          )
            throw new Error('GIF_INVALID');
          const previous = storage.db
            .prepare(
              `SELECT saved.post_id FROM gif_frame_groups saved
        JOIN social_post_drafts post ON post.id=saved.post_id AND post.deleted_at IS NULL AND post.archived_at IS NULL
        WHERE saved.document_id=? AND saved.candidate_id=?`,
            )
            .get(documentId, candidateId) as { post_id: string } | undefined;
          if (previous) return previous.post_id;
          const item = creationItems.findForEntity({ kind: 'GIF_DOCUMENT', id: documentId });
          const form = item?.forms.find((form) => form.entity.kind === 'GIF_DOCUMENT' && form.entity.id === documentId);
          if (!form) throw new Error('GIF_ASSET_UNAVAILABLE');
          const ids = [...new Set(candidate.manifest.frames.map((frame) => frame.assetId))];
          ensureImageMaterials(storage, ids);
          const post = socialPosts.createForm({
            sourceFormId: form.id,
            sourceInspirationStashId: null,
            content: {
              schemaVersion: 1,
              title: candidate.settings.plan?.title || document.title,
              body: '',
              mediaAssetIds: ids,
              coverAssetId: ids[0] ?? null,
            },
          });
          storage.db
            .prepare(
              'INSERT INTO gif_frame_groups(document_id,candidate_id,post_id) VALUES (?,?,?) ON CONFLICT(document_id,candidate_id) DO UPDATE SET post_id=excluded.post_id',
            )
            .run(documentId, candidateId, post.id);
          return post.id;
        })
        .immediate(),
    saveGifWorkspace: (id: string, state: GifWorkspaceState) => documents.saveWorkspace(id, state),
    gifExecutionSeries: (documentId: string) => gifExecutionSeries(storage.db, documentId),
    beginGifGeneration: (input: GifGenerationStart) => generated.begin(input),
    loadGifGeneration: (id: string) => generated.load(id),
    latestGifGeneration: (documentId: string) => generated.latest(documentId),
    gifGenerationHistory: (documentId: string) => generated.history(documentId),
    updateGifGeneration: (
      id: string,
      state: GifGenerationState,
      options?: { generationRunId?: string; manifest?: GifManifest; errorCode?: string; audit?: GifFrameAudit },
    ) => generated.update(id, state, options),
    referenceGifGenerationAsset: (id: string, assetId: string) => generated.reference(id, assetId),
    gifGenerationModelResult: (runId: string) => generated.modelResult(runId),
    storeGifGenerationAsset: (id: string, stored: StoredObject, sources: string[], generationRunId?: string) =>
      generated.storeAsset(id, stored, sources, generationRunId),
    adoptGifGeneration: (input: GifGenerationAdopt) => generated.adopt(input),
    listGifDocuments: (seriesId: string | null, purpose?: GifDocumentPurpose) => documents.list(seriesId, purpose),
    listAnimationWorks: () => documents.list(undefined),
    loadGifDocument: (id: string, revision?: number) => documents.load(id, revision),
    findGifDocumentForAsset: (assetId: string, purpose?: GifDocumentPurpose, seriesId?: string | null) =>
      documents.findForAsset(assetId, purpose, seriesId),
    saveGifDocument: (input: GifSaveInput) => documents.save(input),
    beginGifExport: (input: GifExportInput) => documents.begin(input),
    failGifExport: (runId: string, code: string) => documents.fail(runId, code),
    finishGifExport: (input: GifExportInput, stored: StoredObject) => documents.finish(input, stored),
    storeGifBuffer: (bytes: Uint8Array) => storage.storeBufferAsync(bytes, '.gif'),
    storeGifSourceBuffer: (bytes: Uint8Array, extension: string) => storage.storeBufferAsync(bytes, extension),
  };
}
