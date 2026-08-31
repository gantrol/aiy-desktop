import { normalizeMediaThumbnailSize, type MediaThumbnailCache } from '@/main/media/media-thumbnail-cache';

interface Options {
  url: URL;
  identifier: string;
  assetPath: string | null | undefined;
  codexGeneratedPath: string | null | undefined;
  cache: MediaThumbnailCache;
}

export async function resolveMediaThumbnailRequest({ url, identifier, assetPath, codexGeneratedPath, cache }: Options) {
  const request =
    url.hostname === 'asset-thumbnail' && assetPath
      ? { cacheKey: identifier, sourcePath: assetPath }
      : url.hostname === 'codex-generated-thumbnail' && codexGeneratedPath
        ? {
            cacheKey: `codex-generated:${identifier}:${url.searchParams.get('revision') ?? ''}`,
            sourcePath: codexGeneratedPath,
          }
        : null;
  if (!request) return null;

  try {
    return {
      filePath: await cache.get(
        request.cacheKey,
        request.sourcePath,
        normalizeMediaThumbnailSize(url.searchParams.get('size')),
      ),
      thumbnail: true,
    };
  } catch (error) {
    console.warn('[media-thumbnail] falling back to the original media', {
      hostname: url.hostname,
      identifier,
      error,
    });
    return { filePath: request.sourcePath, thumbnail: false };
  }
}
