import type { Protocol } from 'electron';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { LibraryRegistry } from '@/main/libraries/library-registry';
import type { TransitionPreviewCache } from '@/main/app/transition-preview-cache';
import { resolveMediaRequestPaths } from '@/main/app/media-path-resolver';
import { resolveMediaThumbnailRequest } from '@/main/app/media-thumbnail-request';
import { applyMediaResponseHeaders, CONTEXT_INDEPENDENT_MEDIA_HOSTS, fetchLocalFile } from '@/main/app/media-response';

interface Options {
  activeLibraryContext(): ActiveLibraryContext | null;
  libraryRegistry(): LibraryRegistry | null;
  transitionPreviews: TransitionPreviewCache;
}

export function installMediaProtocol(targetProtocol: Protocol, options: Options) {
  targetProtocol.handle('aiy-media', async (request) => {
    const url = new URL(request.url);
    const identifier = decodeURIComponent(url.pathname.slice(1));
    const context = CONTEXT_INDEPENDENT_MEDIA_HOSTS.has(url.hostname) ? null : options.activeLibraryContext();
    const release = context?.acquireOperation();
    try {
      const resolvedMedia = resolveMediaRequestPaths({
        url,
        identifier,
        context,
        transitionPreviews: options.transitionPreviews,
        libraryRegistry: options.libraryRegistry(),
      });
      const thumbnailRequest = context
        ? await resolveMediaThumbnailRequest({ ...resolvedMedia, url, identifier, cache: context.thumbnails })
        : null;
      if (thumbnailRequest) resolvedMedia.filePath = thumbnailRequest.filePath;
      if (!resolvedMedia.filePath) return new Response('Not found', { status: 404 });

      const response = await fetchLocalFile(resolvedMedia.filePath, request.headers.get('range'));
      const headers = new Headers(response.headers);
      applyMediaResponseHeaders(headers, url.hostname, resolvedMedia.filePath, thumbnailRequest?.thumbnail ?? false);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } finally {
      release?.();
    }
  });
}
