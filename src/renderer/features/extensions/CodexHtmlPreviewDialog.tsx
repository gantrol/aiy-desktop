import { useEffect } from 'react';
import type {
  CodexVisualizationArtifactDto,
  CodexVisualizationHtmlPreviewDto,
} from '@/shared/contracts/codex-visualizations';
import { CodexVisualizationPreviewFrame } from '@/renderer/features/extensions/CodexVisualizationPreviewFrame';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  artifact: CodexVisualizationArtifactDto;
  access: CodexVisualizationHtmlPreviewDto;
  busy: boolean;
  onClose(): void;
  onOpenExternal(): void;
}

export function CodexHtmlPreviewDialog({ artifact, access, busy, onClose, onOpenExternal }: Props) {
  const l = useI18n().messages.extensions.codexVisualizationDiscovery;
  useEffect(() => {
    const remainingMs = Math.max(0, Date.parse(access.expiresAt) - Date.now());
    const timeout = window.setTimeout(onClose, remainingMs);
    return () => window.clearTimeout(timeout);
  }, [access.expiresAt, onClose]);
  return (
    <CodexVisualizationPreviewFrame
      artifact={artifact}
      busy={busy}
      openSourceLabel={l.actions.openExternal}
      onClose={onClose}
      onOpenSource={onOpenExternal}
    >
      <iframe
        key={access.previewId}
        src={access.url}
        title={l.preview.frameTitle(artifact.fileName)}
        sandbox=""
        referrerPolicy="no-referrer"
        allow=""
        className="size-full min-h-0 bg-background"
      />
    </CodexVisualizationPreviewFrame>
  );
}
