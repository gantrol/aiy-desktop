import { useRef, useState, type ReactNode } from 'react';
import { Copy, Download, ExternalLink, FolderOpen, MoreHorizontal, X } from 'lucide-react';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { contentAssetFileAction } from '@/renderer/features/content-editor/contentAssetFileActions';
import type { PetalAssetFileCommand } from '@/shared/contracts/petal-workspace';

interface Props {
  assetId: string | null | undefined;
  remove?: () => void;
  children: ReactNode;
}

/** Keep the main host's richer actions; restricted hosts expose only the capabilities they have. */
export function ContentImageContextMenu({ assetId, remove, children }: Props) {
  const copy = useI18n().messages.desktopPetals.contentEntry;
  if (assetId && window.desktopApi)
    return (
      <AssetFileContextMenu
        assetId={assetId}
        draggable={false}
        actions={
          remove
            ? [
                {
                  id: 'content-image-remove',
                  label: copy.removeUse,
                  icon: X,
                  destructive: true,
                  onSelect: remove,
                },
              ]
            : []
        }
      >
        {children}
      </AssetFileContextMenu>
    );
  return (
    <RestrictedImageMenu assetId={assetId} remove={remove}>
      {children}
    </RestrictedImageMenu>
  );
}

function RestrictedImageMenu({ assetId, remove, children }: Props) {
  const copy = useI18n().messages.desktopPetals.contentEntry;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const running = useRef(false);
  const filesAvailable = Boolean(assetId && window.desktopPetals?.assetFile);
  const execute = async (action: PetalAssetFileCommand['action']) => {
    if (!assetId || running.current) return;
    running.current = true;
    setBusy(true);
    setStatus('');
    try {
      const result = await contentAssetFileAction({ assetId, action });
      if (result.status !== 'cancelled')
        setStatus(action === 'copy' ? copy.copied : action === 'save-as' ? copy.exported : '');
    } catch {
      setStatus(copy.actionFailed);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <div
        className="relative"
        onContextMenu={(event) => {
          if (event.defaultPrevented) return;
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {children}
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label={copy.openFile}
            className="absolute right-2 top-2 z-20"
            disabled={busy}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        {status && (
          <p role="status" className="relative z-20 bg-background px-2 py-1 text-xs">
            {status}
          </p>
        )}
      </div>
      <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
        <DropdownMenuItem disabled={busy || !filesAvailable} onSelect={() => void execute('copy')}>
          <Copy />
          {copy.copyImage}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy || !filesAvailable} onSelect={() => void execute('save-as')}>
          <Download />
          {copy.saveAs}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy || !filesAvailable} onSelect={() => void execute('open')}>
          <ExternalLink />
          {copy.openFile}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={busy || !filesAvailable} onSelect={() => void execute('reveal')}>
          <FolderOpen />
          {copy.reveal}
        </DropdownMenuItem>
        {remove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={busy} className="text-destructive" onSelect={remove}>
              <X />
              {copy.removeUse}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
