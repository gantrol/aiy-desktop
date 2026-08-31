import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { LibraryRegistry } from '@/main/libraries/library-registry';
import type { TransitionPreviewCache } from '@/main/app/transition-preview-cache';
import { resolveVideoKeyChangeMediaPath } from '@/main/video-documents/key-change-service';
import { CODEX_IMAGE_DISCOVERY_EXTENSION_ID, CODEX_VISUALIZATION_DISCOVERY_EXTENSION_ID } from '@/shared/extension-ids';

interface Options {
  url: URL;
  identifier: string;
  context: ActiveLibraryContext | null;
  transitionPreviews: TransitionPreviewCache;
  libraryRegistry: LibraryRegistry | null;
}

export function resolveMediaRequestPaths({ url, identifier, context, transitionPreviews, libraryRegistry }: Options) {
  const assetPath =
    url.hostname === 'asset' || url.hostname === 'asset-thumbnail' ? context?.database.getAssetPath(identifier) : null;
  const codexGeneratedPath =
    (url.hostname === 'codex-generated' || url.hostname === 'codex-generated-thumbnail') &&
    context?.extensions.isActivated(CODEX_IMAGE_DISCOVERY_EXTENSION_ID)
      ? context.imageDiscovery.resolveMediaPath(identifier)
      : null;
  const filePath =
    url.hostname === 'space-preview'
      ? transitionPreviews.resolveFile(identifier)
      : url.hostname === 'space-cover'
        ? libraryRegistry?.resolveCoverPath(identifier, url.searchParams.get('revision'))
        : url.hostname === 'asset'
          ? assetPath
          : url.hostname === 'video-evidence' && context
            ? resolveVideoKeyChangeMediaPath(context.database.libraryRoot, identifier)
            : url.hostname === 'codex-generated'
              ? codexGeneratedPath
              : url.hostname === 'codex-visualization' &&
                  context?.extensions.isActivated(CODEX_VISUALIZATION_DISCOVERY_EXTENSION_ID)
                ? context.visualizationDiscovery.resolveMediaPath(identifier)
                : null;
  return { assetPath, codexGeneratedPath, filePath };
}
