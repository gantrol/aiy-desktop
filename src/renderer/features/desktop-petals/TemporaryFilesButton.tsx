import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { TemporaryFilesPanel } from '@/renderer/features/desktop-petals/TemporaryFilesPanel';
import { useI18n } from '@/renderer/i18n/useI18n';

export function TemporaryFilesButton() {
  const label = useI18n().messages.desktopPetals.temporary.title;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
        </DialogHeader>
        <TemporaryFilesPanel />
      </DialogContent>
    </Dialog>
  );
}
