import { useEffect, useState } from 'react';
import type { ImageGenerationRouteDto } from '@/shared/contracts';
import type { GifErrorCode } from '@/shared/contracts/gif-making';
import { CODEX_APP_SERVER_IMAGE_MODEL_KEY, CODEX_CLI_IMAGE_MODEL_KEY } from '@/shared/extension-ids';

export function useGifGenerationRoutes(open: boolean, setError: (error: GifErrorCode | null) => void) {
  const [routes, setRoutes] = useState<ImageGenerationRouteDto[]>([]);
  const [modelKey, setModelKey] = useState('');
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.desktopApi
      .gifGenerationRoutes()
      .then((items) => {
        if (cancelled) return;
        setRoutes(items);
        setModelKey(
          (previous) =>
            previous ||
            items.find((r) => r.key === CODEX_APP_SERVER_IMAGE_MODEL_KEY && r.state === 'READY')?.key ||
            items.find((r) => r.state === 'READY' && r.key !== CODEX_CLI_IMAGE_MODEL_KEY)?.key ||
            '',
        );
      })
      .catch(() => {
        if (!cancelled) setError('GIF_MODEL_UNAVAILABLE');
      });
    return () => {
      cancelled = true;
    };
  }, [open, setError]);
  return { routes, modelKey, setModelKey };
}
