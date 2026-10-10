import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HtmlFileAttributes, HtmlFilePreviewAccess } from '@/shared/contracts/html-file';
import { Button } from '@/renderer/components/ui/button';
import { EmbeddedWebPreview } from '@/renderer/features/extensions/EmbeddedWebPreview';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  ReadingText,
  type ReadingSelection,
  type ReadingReveal,
  type ReadingViewportPosition,
} from '@/renderer/features/creation-reading/ReadingText';
import type { ReadingPosition } from '@/shared/contracts/creation-reading';

export function ReadingHtml({
  file,
  visible,
  previewRequest,
  onSelect,
  reveal,
  initialPosition,
  onPosition,
  onRevealFailed,
}: {
  file: HtmlFileAttributes;
  visible: boolean;
  previewRequest: number;
  reveal?: ReadingReveal;
  initialPosition?: ReadingPosition;
  onPosition(position: ReadingViewportPosition): void;
  onRevealFailed(): void;
  onSelect(value: ReadingSelection | null): void;
}) {
  const copy = useI18n().messages.creationReading;
  const { objectHash, fileName, spaceId } = file;
  const stableFile = useMemo(() => ({ objectHash, fileName, spaceId }), [objectHash, fileName, spaceId]);
  const runtimeCopy = useI18n().messages.extensions.codexVisualizationDiscovery.preview;
  const [text, setText] = useState<string | null>(null);
  const [access, setAccess] = useState<HtmlFilePreviewAccess | null>(null);
  const [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    lastRequest = useRef(0);
  const close = useCallback(() => {
    generation.current++;
    setAccess(null);
    setBusy(false);
  }, []);
  useEffect(() => {
    setText(null);
    setFailed(false);
    close();
    return close;
  }, [stableFile, close]);
  useEffect(() => {
    if (reveal) close();
  }, [reveal, close]);
  useEffect(() => {
    if (!visible || text !== null) return;
    let disposed = false;
    const worker = new Worker(new URL('./html-text.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ text?: string }>) => {
      if (!disposed) {
        setText(event.data.text ?? null);
        setFailed(event.data.text === undefined);
      }
      worker.terminate();
    };
    worker.onerror = () => {
      if (!disposed) setFailed(true);
      worker.terminate();
    };
    void window.desktopApi
      .htmlFileRead(stableFile)
      .then((value) => {
        if (!disposed) worker.postMessage(value);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      worker.terminate();
    };
  }, [stableFile, visible, text]);
  useEffect(() => {
    if (!access) return;
    const timer = window.setTimeout(close, Math.max(0, Date.parse(access.expiresAt) - Date.now()));
    return () => {
      clearTimeout(timer);
      void window.desktopApi.htmlFileRelease({ previewId: access.previewId }).catch(() => undefined);
    };
  }, [access, close]);
  useEffect(() => {
    if (!visible) close();
  }, [visible, close]);
  const start = useCallback(async () => {
    const request = ++generation.current;
    setBusy(true);
    setFailed(false);
    try {
      const next = await window.desktopApi.htmlFilePreview(stableFile);
      if (request !== generation.current) {
        await window.desktopApi.htmlFileRelease({ previewId: next.previewId });
        return;
      }
      onSelect(null);
      setAccess(next);
    } catch {
      if (request === generation.current) setFailed(true);
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }, [stableFile, onSelect]);
  useEffect(() => {
    if (visible && previewRequest && previewRequest !== lastRequest.current) {
      lastRequest.current = previewRequest;
      void start();
    }
  }, [previewRequest, visible, start]);
  return (
    <>
      <div className="flex min-h-10 shrink-0 items-center gap-2 border-b px-2">
        <Button size="sm" variant={!access ? 'secondary' : 'ghost'} onClick={close}>
          {copy.textView}
        </Button>
        <Button
          size="sm"
          variant={access ? 'secondary' : 'ghost'}
          disabled={busy || !!access}
          onClick={() => void start()}
        >
          {copy.webView}
        </Button>
        {access && (
          <span className="text-xs text-muted-foreground">
            {access.scriptsAllowed ? runtimeCopy.offlineRuntime : runtimeCopy.restricted}
          </span>
        )}
        {access && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={close}>
            {copy.stop}
          </Button>
        )}
      </div>
      {failed && (
        <div role="alert" className="p-3 text-sm text-destructive">
          {copy.fileFailed}
        </div>
      )}
      {access ? (
        access.scriptsAllowed ? (
          <EmbeddedWebPreview previewId={access.previewId} onClose={close} />
        ) : (
          <iframe
            src={access.url}
            title={file.fileName}
            sandbox=""
            referrerPolicy="no-referrer"
            allow=""
            className="min-h-0 w-full flex-1 border-0 bg-background"
          />
        )
      ) : text !== null ? (
        <ReadingText
          text={text}
          location={{}}
          onSelect={onSelect}
          reveal={reveal}
          initialPosition={initialPosition}
          onPosition={onPosition}
          onRevealFailed={onRevealFailed}
        />
      ) : (
        !failed && (
          <div role="status" className="p-3 text-sm text-muted-foreground">
            {copy.loading}
          </div>
        )
      )}
    </>
  );
}
