import { FileTextIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CodexVisualizationArtifactDto } from '@/shared/contracts/codex-visualizations';
import {
  codexMermaidPreviewCacheKey,
  renderCodexMermaidSvg,
} from '@/renderer/features/extensions/codexMermaidRenderer';

interface Props {
  artifact: CodexVisualizationArtifactDto;
}

export function CodexMermaidThumbnail({ artifact }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [requested, setRequested] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setRequested(true);
        observer.disconnect();
      },
      { rootMargin: '160px' },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!requested) return;
    let disposed = false;
    let objectUrl = '';
    void (async () => {
      try {
        const access = await window.desktopApi.codexVisualizationPrepareMermaidPreview({ artifactId: artifact.id });
        const svg = await renderCodexMermaidSvg(codexMermaidPreviewCacheKey(artifact), access);
        if (disposed) return;
        objectUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
        setPreviewUrl(objectUrl);
      } catch {
        return;
      }
    })();
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact, requested]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 grid place-items-center"
    >
      {previewUrl ? (
        <img src={previewUrl} alt="" draggable={false} className="size-full object-contain p-3" />
      ) : (
        <FileTextIcon className="size-8" />
      )}
    </div>
  );
}
