import { useEffect, useState } from 'react';
import type { ImageEditDocument } from '@/shared/contracts/image-edit';
import { rasterImageEdit } from '@/renderer/features/image-editing/image-edit-raster';

export function ImageEditRasterPreview({
  image,
  document,
  onError,
}: {
  image: HTMLImageElement;
  document: ImageEditDocument;
  onError(): void;
}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => {
      void rasterImageEdit(image, document, true, abort.signal)
        .then((blob) => {
          if (abort.signal.aborted) return;
          setUrl(URL.createObjectURL(blob));
        })
        .catch(() => {
          if (!abort.signal.aborted) onError();
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [image, document, onError]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url ? <image href={url} width={document.width} height={document.height} pointerEvents="none" /> : null;
}
