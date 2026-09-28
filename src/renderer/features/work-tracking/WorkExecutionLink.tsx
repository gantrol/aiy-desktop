import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { contentLibraryApi } from '@/renderer/features/content-editor/ContentReferencePicker';
import { openAppContentLink } from '@/renderer/components/app/app-content-link';
import { parseAiyDeepLink } from '@/shared/contracts/app-deep-link';

export function WorkExecutionLink({
  reference,
  title,
  compact = false,
}: {
  reference: string;
  title: string;
  compact?: boolean;
}) {
  const l = useI18n().messages.workTracking;
  const [openFailed, setOpenFailed] = useState(false);
  const open = async () => {
    setOpenFailed(false);
    try {
      if (parseAiyDeepLink(reference)) setOpenFailed(!openAppContentLink(reference));
      else await contentLibraryApi().linkOpen(reference);
    } catch {
      setOpenFailed(true);
    }
  };
  return (
    <>
      <Button
        variant={compact ? 'ghost' : 'link'}
        size={compact ? 'icon-sm' : 'default'}
        className={compact ? 'size-7' : 'h-auto justify-start whitespace-normal p-0 text-left'}
        aria-label={compact ? `${l.openExecution}: ${title}` : undefined}
        title={compact ? l.openExecution : undefined}
        onClick={() => void open()}
      >
        {compact ? <ExternalLink className="size-3.5" /> : title}
      </Button>
      {openFailed && (
        <span role="alert" className="text-xs text-destructive">
          {l.errors.sourceUnavailable}
        </span>
      )}
    </>
  );
}
