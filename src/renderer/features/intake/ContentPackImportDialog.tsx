import { PackImportDialog } from '@/renderer/features/packs/PackImportDialog';

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  onImported(): Promise<void>;
  notify(message: string): void;
}

export function ContentPackImportDialog({ open, onOpenChange, onImported, notify }: Props) {
  return (
    <PackImportDialog open={open} onOpenChange={onOpenChange} onApplied={async () => onImported()} notify={notify} />
  );
}
