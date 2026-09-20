import type { Protocol } from 'electron';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { LibraryRegistry } from '@/main/libraries/library-registry';
import type { TransitionPreviewCache } from '@/main/app/transition-preview-cache';
import { resolveMediaRequestPaths } from '@/main/app/media-path-resolver';
import { resolveMediaThumbnailRequest } from '@/main/app/media-thumbnail-request';
import { applyMediaResponseHeaders, CONTEXT_INDEPENDENT_MEDIA_HOSTS, fetchLocalFile } from '@/main/app/media-response';
import { PACKAGED_RENDERER_URL } from '@/main/app/renderer-protocol';
import { resolveNoteFile } from '@/main/desktop-petals/note-file-store';

interface Options {
  activeLibraryContext(): ActiveLibraryContext | null;
  libraryRegistry(): LibraryRegistry | null;
  transitionPreviews: TransitionPreviewCache;
  rendererUrl?: URL;
}

export function installMediaProtocol(targetProtocol: Protocol, options: Options) {
  const rendererUrl = options.rendererUrl ?? new URL(PACKAGED_RENDERER_URL);
  // Node reports opaque origins for custom schemes; Chromium uses their registered host.
  const rendererOrigin = `${rendererUrl.protocol}//${rendererUrl.host}`;
  targetProtocol.handle('aiy-media', async (request) => {
    const url = new URL(request.url);
    const identifier = decodeURIComponent(url.pathname.slice(1));
    const context = CONTEXT_INDEPENDENT_MEDIA_HOSTS.has(url.hostname) ? null : options.activeLibraryContext();
    const release = context?.acquireOperation();
    try {
      if (url.hostname === 'note-file') {
        if (
          !context ||
          context.state !== 'ACTIVE' ||
          (context.library.id !== url.searchParams.get('library') &&
            context.database.getLocalSpace().id !== url.searchParams.get('library'))
        )
          return new Response(null, { status: 404 });
        const resolved = await (async () => {
          try {
            const stash = context.database.getInspirationStash(identifier);
            const file = stash.content.files?.find((file) => file.id === url.searchParams.get('file'));
            if (stash.status !== 'ACTIVE' || !file || !/^(audio|video)\//.test(file.mimeType)) return null;
            return { file, filePath: await resolveNoteFile(context.database.libraryRoot, file) };
          } catch {
            return null;
          }
        })();
        if (!resolved) return new Response(null, { status: 404 });
        const { file, filePath } = resolved;
        const response = await fetchLocalFile(filePath, request.headers.get('range'));
        const headers = new Headers(response.headers);
        applyMediaResponseHeaders(headers, url.hostname, filePath, false);
        headers.set('content-type', file.mimeType);
        headers.set('access-control-allow-origin', rendererOrigin);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      }
      const resolvedMedia = await resolveMediaRequestPaths({
        url,
        identifier,
        context,
        transitionPreviews: options.transitionPreviews,
        libraryRegistry: options.libraryRegistry(),
      });
      const thumbnailRequest = context
        ? await resolveMediaThumbnailRequest({ ...resolvedMedia, url, identifier, cache: context.thumbnails })
        : null;
      if (thumbnailRequest) {
        if (!thumbnailRequest.filePath) {
          return new Response('Thumbnail unavailable', { status: 404, headers: { 'cache-control': 'no-store' } });
        }
        resolvedMedia.filePath = thumbnailRequest.filePath;
      }
      if (!resolvedMedia.filePath) return new Response('Not found', { status: 404 });

      const response = await fetchLocalFile(resolvedMedia.filePath, request.headers.get('range'));
      const headers = new Headers(response.headers);
      applyMediaResponseHeaders(headers, url.hostname, resolvedMedia.filePath, thumbnailRequest?.thumbnail ?? false);
      // Permit canvas sampling from the application renderer without exposing media to other origins.
      headers.set('access-control-allow-origin', rendererOrigin);
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
