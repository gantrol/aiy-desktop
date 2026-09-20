import { useEffect, useMemo, useRef, useState } from 'react';
import { LoaderCircleIcon } from 'lucide-react';
import { renderCodexMermaidSvg } from '@/renderer/features/extensions/codexMermaidRenderer';

function sourceKey(source: string) {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${source.length}-${(hash >>> 0).toString(36)}`;
}

export function CodexHistoryMermaid({ source, label }: { source: string; label: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [requested, setRequested] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const key = useMemo(() => sourceKey(source), [source]);

  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setRequested(true);
        observer.disconnect();
      },
      { rootMargin: '240px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!requested) return;
    let disposed = false;
    let objectUrl = '';
    void renderCodexMermaidSvg(`history:${key}:${document.documentElement.dataset.theme ?? 'light'}`, {
      artifactId: `history-${key}`,
      sourceText: source,
    })
      .then((svg) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (!disposed) setFailed(true);
      });
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, requested, source]);

  if (failed) {
    return (
      <pre className="overflow-x-auto">
        <code className="language-mermaid">{source}</code>
      </pre>
    );
  }
  return (
    <div ref={containerRef} className="my-3 grid min-h-28 place-items-center overflow-auto border-y py-3">
      {previewUrl ? (
        <img src={previewUrl} alt={label} draggable={false} className="max-h-[32rem] max-w-full" />
      ) : (
        <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" aria-label={label} />
      )}
    </div>
  );
}
