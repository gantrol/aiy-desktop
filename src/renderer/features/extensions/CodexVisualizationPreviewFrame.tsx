import { ShieldCheckIcon, SquareArrowOutUpRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CodexVisualizationArtifactDto } from '@/shared/contracts/codex-visualizations';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  artifact: CodexVisualizationArtifactDto;
  busy: boolean;
  openSourceLabel: string;
  children: ReactNode;
  onClose(): void;
  onOpenSource(): void;
}

export function CodexVisualizationPreviewFrame({
  artifact,
  busy,
  openSourceLabel,
  children,
  onClose,
  onOpenSource,
}: Props) {
  const l = useI18n().messages.extensions.codexVisualizationDiscovery;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="h-[min(90vh,56rem)] w-[min(96vw,90rem)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-lg p-0"
      >
        <header className="flex min-w-0 items-center gap-2 border-b px-4 py-3 pr-14">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm" title={artifact.relativePath}>
            {artifact.fileName}
          </DialogTitle>
          <Badge variant="outline" className="gap-1">
            <ShieldCheckIcon className="size-3" />
            {l.preview.restricted}
          </Badge>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onOpenSource}>
            <SquareArrowOutUpRightIcon className="size-4" />
            {openSourceLabel}
          </Button>
        </header>
        {children}
      </DialogContent>
    </Dialog>
  );
}
