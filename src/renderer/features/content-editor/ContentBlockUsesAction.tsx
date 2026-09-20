import { useState } from 'react';
import { Link } from 'lucide-react';
import { DropdownMenuItem } from '@/renderer/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useContentReferenceHost } from '@/renderer/features/content-editor/ContentReferenceHost';
import { ContentReferenceUses } from '@/renderer/features/content-editor/ContentReferenceUses';

export function ContentBlockUsesAction({ blockId }: { blockId: string }) {
  const { source } = useContentReferenceHost();
  const copy = useI18n().messages.referenceOutline;
  const [open, setOpen] = useState(false);
  if (!source || !blockId) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        <Link />
        {copy.findUses}
      </DropdownMenuItem>
      <DialogContent className="flex max-h-[80vh] max-w-xl flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{copy.uses}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          <ContentReferenceUses
            target={{ source, blockId, scope: 'SELF' }}
            originBlockId={blockId}
            onNavigated={() => setOpen(false)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
