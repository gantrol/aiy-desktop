import { randomUUID } from 'node:crypto';
import type {
  BrowserCompanionOutputImporter,
  BrowserCompanionOutputImportResult,
} from '@/main/browser-companion/loopback-server';
import { CreatorImageStagingService } from '@/main/creations/creator-image-staging';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { withDecodedImageBytesInSandbox } from '@/main/media/sandboxed-image-decoder';

interface BrowserCompanionOutputImporterOptions {
  getActiveContext(): ActiveLibraryContext | null;
  onImported(context: ActiveLibraryContext): void;
}

export function createBrowserCompanionOutputImporter({
  getActiveContext,
  onImported,
}: BrowserCompanionOutputImporterOptions): BrowserCompanionOutputImporter {
  return async (input): Promise<BrowserCompanionOutputImportResult> => {
    const context = getActiveContext();
    if (!context) throw new Error('Library services are unavailable');
    const release = context.acquireOperation();
    try {
      const source = input.handoff.source;
      if (source.kind !== 'creation-draft' || !source.outputTarget) {
        throw new Error('The ChatGPT output is not linked to a creation');
      }
      const target = context.database.getBrowserCompanionOutputTarget({
        creationDraftId: source.id,
        ...source.outputTarget,
      });
      await withDecodedImageBytesInSandbox(
        input.bytes,
        input.image.mimeType,
        { operation: 'normalize' },
        () => undefined,
        60_000,
      );

      const stages = new CreatorImageStagingService(() => context.database);
      const [staged] = await stages.stageItems([
        {
          id: randomUUID(),
          name: input.image.fileName,
          mimeType: input.image.mimeType,
          bytes: input.bytes,
          metadata: {
            displayName: input.image.fileName,
            note: '',
            sourceUrl: input.sourceUrl,
            aiGeneratedStatus: 'YES',
            modelName: 'ChatGPT App',
            modelProvider: 'OpenAI',
            modelVersion: '',
            generationTextType: 'EXACT_PROMPT',
            generationText: input.handoff.text,
          },
        },
      ]);
      if (!staged || staged.state !== 'READY' || !staged.item.stageId) {
        throw new Error('The ChatGPT image could not be staged for import');
      }
      const imported = await stages.import({
        context: {
          seriesId: target.seriesId,
          versionId: target.promptVersionId,
          title: target.title,
          titleLocale: target.titleLocale,
          source: 'UPLOAD',
          sourceUrl: input.sourceUrl,
        },
        items: [
          {
            stageId: staged.item.stageId,
            promptVersionId: target.promptVersionId,
            displayName: input.image.fileName,
          },
        ],
      });
      const imageAssetId =
        imported.assetIds[0] ??
        context.database.findImportedCreatorOutputAssetByHash(target.seriesId, input.image.sha256);
      if (!imageAssetId) throw new Error('The ChatGPT image could not be resolved after import');
      context.database.setPromptSeriesCover({ seriesId: target.seriesId, imageAssetIds: [imageAssetId] });

      const adopted = target.derivedVisualId === null;
      onImported(context);
      return {
        seriesId: target.seriesId,
        promptVersionId: target.promptVersionId,
        imageAssetId,
        adopted,
      };
    } finally {
      release();
    }
  };
}
