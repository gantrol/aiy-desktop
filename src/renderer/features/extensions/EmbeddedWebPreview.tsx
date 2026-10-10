import { useEffect, useRef, useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import type { EmbeddedWebBounds } from '@/shared/contracts/embedded-web';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { embeddedWebBounds } from '@/renderer/features/extensions/embeddedWebBounds';

export function EmbeddedWebPreview({ previewId, onClose }: { previewId: string; onClose(): void }) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'LOADING' | 'READY' | 'FAILED' | 'BUSY'>('LOADING');
  const replace = useRef<() => void>(() => undefined);
  const l = useI18n().messages.extensions.codexVisualizationDiscovery.preview;

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const api = window.desktopApi;
    let disposed = false;
    let inFlight = false;
    let pending: EmbeddedWebBounds | null = null;
    let animationFrame = 0;
    let lastBounds = '';
    let replaceExisting = false;
    const flush = async () => {
      if (inFlight || !pending || disposed) return;
      const bounds = pending;
      pending = null;
      inFlight = true;
      const replaceRequested = replaceExisting;
      replaceExisting = false;
      try {
        if (!bounds.width || !bounds.height) {
          await api.embeddedWebHide({ previewId });
          return;
        }
        await api.embeddedWebShow({ previewId, bounds, replaceExisting: replaceRequested });
        if (!disposed) setState('READY');
      } catch (error) {
        if (!disposed) setState(String(error).includes('EMBEDDED_WEB_BUSY') ? 'BUSY' : 'FAILED');
      } finally {
        inFlight = false;
        if (pending && !disposed) void flush();
      }
    };
    replace.current = () => {
      replaceExisting = true;
      lastBounds = '';
      setState('LOADING');
      measure();
    };
    const measure = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(() => {
        if (disposed) return;
        const bounds = embeddedWebBounds(element);
        const serialized = JSON.stringify(bounds);
        if (serialized === lastBounds) return;
        lastBounds = serialized;
        pending = bounds;
        void flush();
      });
    };
    const unsubscribe = api.onEmbeddedWebClosed((event) => {
      if (disposed || event.previewId !== previewId) return;
      if (event.reason === 'STOPPED') onClose();
      else setState('FAILED');
    });
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    measure();
    return () => {
      disposed = true;
      replace.current = () => undefined;
      pending = null;
      observer.disconnect();
      unsubscribe();
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      void api.embeddedWebHide({ previewId }).catch(() => undefined);
    };
  }, [previewId, onClose]);

  return (
    <div
      ref={container}
      role="region"
      aria-label={l.runtimeFrame}
      className="grid size-full min-h-0 place-items-center bg-background"
    >
      {state === 'LOADING' && (
        <LoaderCircleIcon
          role="status"
          aria-label={l.runtimeLoading}
          className="size-5 animate-spin motion-reduce:animate-none"
        />
      )}
      {state === 'FAILED' && (
        <span role="alert" className="text-sm text-destructive">
          {l.runtimeFailed}
        </span>
      )}
      {state === 'BUSY' && (
        <div className="flex flex-col items-center gap-2 p-3">
          <span role="status" className="text-sm text-muted-foreground">
            {l.runtimeBusy}
          </span>
          <Button size="sm" variant="outline" onClick={() => replace.current()}>
            {l.runtimeReplace}
          </Button>
        </div>
      )}
    </div>
  );
}
