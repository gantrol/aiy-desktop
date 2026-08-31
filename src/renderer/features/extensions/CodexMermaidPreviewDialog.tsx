import { LoaderCircleIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type {
  CodexVisualizationArtifactDto,
  CodexVisualizationMermaidPreviewDto,
} from '@/shared/contracts/codex-visualizations';
import {
  codexMermaidPreviewCacheKey,
  renderCodexMermaidSvg,
} from '@/renderer/features/extensions/codexMermaidRenderer';
import { CodexMermaidPanZoom } from '@/renderer/features/extensions/CodexMermaidPanZoom';
import { CodexVisualizationPreviewFrame } from '@/renderer/features/extensions/CodexVisualizationPreviewFrame';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  artifact: CodexVisualizationArtifactDto;
  access: CodexVisualizationMermaidPreviewDto;
  busy: boolean;
  openSourceLabel: string;
  onClose(): void;
  onOpenSource(): void;
}

export function CodexMermaidPreviewDialog({ artifact, access, busy, openSourceLabel, onClose, onOpenSource }: Props) {
  const l = useI18n().messages.extensions.codexVisualizationDiscovery;
  const [previewUrl, setPreviewUrl] = useState('');
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let objectUrl = '';
    setPreviewUrl('');
    setRenderFailed(false);
    void (async () => {
      try {
        const staticSvg = await renderCodexMermaidSvg(codexMermaidPreviewCacheKey(artifact), access);
        objectUrl = URL.createObjectURL(new Blob([staticSvg], { type: 'image/svg+xml' }));
        if (disposed) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = '';
          return;
        }
        setPreviewUrl(objectUrl);
      } catch {
        if (!disposed) setRenderFailed(true);
      }
    })();
    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [access, artifact]);

  return (
    <CodexVisualizationPreviewFrame
      artifact={artifact}
      busy={busy}
      openSourceLabel={openSourceLabel}
      onClose={onClose}
      onOpenSource={onOpenSource}
    >
      <div className="grid size-full min-h-0 place-items-center overflow-hidden bg-surface-sunken">
        {!previewUrl && !renderFailed && <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />}
        {renderFailed && <div className="text-sm text-muted-foreground">{l.preview.unavailable}</div>}
        {previewUrl && (
          <CodexMermaidPanZoom
            src={previewUrl}
            alt={l.preview.frameTitle(artifact.fileName)}
            labels={{
              fit: l.preview.fit,
              read: l.preview.read,
              minimap: l.preview.minimap,
              zoomIn: l.preview.zoomIn,
              zoomOut: l.preview.zoomOut,
            }}
          />
        )}
      </div>
    </CodexVisualizationPreviewFrame>
  );
}
