import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  message: string;
  onDismiss(): void;
  onOpenCurrent(): void;
}

export function DerivedVisualResumeDialog({ message, onDismiss, onOpenCurrent }: Props) {
  const { messages } = useI18n();
  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent aria-describedby={undefined} className="max-w-sm rounded-md" showCloseButton={false}>
        <DialogTitle>{message}</DialogTitle>
        <DialogFooter>
          <Button variant="ghost" onClick={onDismiss} autoFocus>
            {messages.common.cancel}
          </Button>
          <Button onClick={onOpenCurrent}>{messages.creator.derivedVisual.openCurrentVersion}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
