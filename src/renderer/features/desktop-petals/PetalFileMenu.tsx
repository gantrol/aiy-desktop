import { Copy, Download, ExternalLink } from 'lucide-react';
import { DropdownMenuItem } from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { usePetalMenuApi } from '@/renderer/features/desktop-petals/petal-menu-api';
import type { PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';

export function PetalFileMenu({
  temporary,
  persisted,
  disabled,
  onOpenFile,
  onCopyImage,
  onSaveAs,
  select,
}: Pick<PetalNoteMenuActions, 'temporary' | 'persisted' | 'disabled' | 'onOpenFile' | 'onCopyImage' | 'onSaveAs'> & {
  select(action: () => Promise<unknown>): (event: Event) => void;
}) {
  const copy = useI18n().messages.desktopPetals;
  const api = usePetalMenuApi();
  return (
    <>
      {(!temporary || onOpenFile) && (
        <DropdownMenuItem disabled={disabled || !persisted} onSelect={select(onOpenFile ?? api.openMain)}>
          <ExternalLink />
          {onOpenFile ? copy.contentEntry.openFile : copy.actions.openSource}
        </DropdownMenuItem>
      )}
      {onCopyImage && (
        <DropdownMenuItem disabled={disabled} onSelect={select(onCopyImage)}>
          <Copy />
          {copy.contentEntry.copyImage}
        </DropdownMenuItem>
      )}
      {onSaveAs && (
        <DropdownMenuItem disabled={disabled} onSelect={select(onSaveAs)}>
          <Download />
          {copy.contentEntry.saveAs}
        </DropdownMenuItem>
      )}
    </>
  );
}
