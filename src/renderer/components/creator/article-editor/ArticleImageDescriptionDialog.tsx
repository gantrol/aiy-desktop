import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/renderer/components/ui/dialog';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useI18n } from '@/renderer/i18n/useI18n';

export function ArticleImageDescriptionDialog({
  initial,
  onApply,
  onClose,
  onRestoreFocus,
}: {
  initial: string;
  onApply(alt: string): boolean;
  onClose(): void;
  onRestoreFocus(): void;
}) {
  const copy = useI18n().messages.contentEditor;
  const [value, setValue] = useState(initial);
  const [failed, setFailed] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-sm rounded-sm"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogTitle>{copy.imageDescription}</DialogTitle>
        <Textarea
          value={value}
          maxLength={2000}
          aria-label={copy.imageDescription}
          onChange={(event) => setValue(event.target.value)}
          autoFocus
        />
        {failed && (
          <div role="alert" className="text-xs text-destructive">
            {copy.imageDescriptionChanged}
          </div>
        )}
        <Button
          onClick={() => {
            if (onApply(value)) onClose();
            else setFailed(true);
          }}
        >
          {copy.applyImageDescription}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
