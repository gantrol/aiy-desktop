import { useEffect } from 'react';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { X } from 'lucide-react';
import { EmbeddedWebPreview } from '@/renderer/features/extensions/EmbeddedWebPreview';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { HtmlFilePreviewAccess } from '@/shared/contracts/html-file';

export function HtmlFilePreviewDialog({
  access,
  fileName,
  onClose,
}: {
  access: HtmlFilePreviewAccess;
  fileName: string;
  onClose(): void;
}) {
  const copy = useI18n().messages.extensions.codexVisualizationDiscovery.preview;
  const closeLabel = useI18n().messages.common.close;
  useEffect(() => {
    const timer = window.setTimeout(onClose, Math.max(0, Date.parse(access.expiresAt) - Date.now()));
    return () => window.clearTimeout(timer);
  }, [access.expiresAt, onClose]);
  return (
    <section
      aria-label={fileName}
      className="flex h-[min(65vh,36rem)] w-full min-w-0 flex-col overflow-hidden border bg-background"
    >
      <header className="flex min-w-0 items-center gap-2 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm">{fileName}</span>
        <Badge variant="outline">{access.scriptsAllowed ? copy.offlineRuntime : copy.restricted}</Badge>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={closeLabel} onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>
      {access.scriptsAllowed ? (
        <EmbeddedWebPreview previewId={access.previewId} onClose={onClose} />
      ) : (
        <iframe
          src={access.url}
          title={copy.frameTitle(fileName)}
          sandbox=""
          referrerPolicy="no-referrer"
          allow=""
          className="size-full min-h-0 bg-background"
        />
      )}
    </section>
  );
}
