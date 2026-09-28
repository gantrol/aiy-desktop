import { normalizeMediaThumbnailSize, type MediaThumbnailCache } from '@/main/media/media-thumbnail-cache';

interface Options {
  url: URL;
  identifier: string;
  assetPath: string | null | undefined;
  codexGeneratedPath: string | null | undefined;
  cache: MediaThumbnailCache;
}

interface ThumbnailRequest {
  filePath: string | null;
  svgBytes?: Buffer;
  thumbnail: true;
}

export async function resolveMediaThumbnailRequest({
  url,
  identifier,
  assetPath,
  codexGeneratedPath,
  cache,
}: Options): Promise<ThumbnailRequest | null> {
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
    const svgBytes = await cache.getSimpleSvg(request.cacheKey, request.sourcePath);
    if (svgBytes) return { filePath: null, svgBytes, thumbnail: true };
    return {
      filePath: await cache.get(
        request.cacheKey,
        request.sourcePath,
        normalizeMediaThumbnailSize(url.searchParams.get('size')),
      ),
      thumbnail: true,
    };
  } catch (error) {
    console.warn('[media-thumbnail] static thumbnail unavailable', {
      hostname: url.hostname,
      identifier,
      error,
    });
    // A thumbnail URL must never serve animated originals, including formats
    // added later. Keep failure distinct from an unrecognized media request.
    return { filePath: null, thumbnail: true };
  }
}
