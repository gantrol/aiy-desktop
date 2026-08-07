import { useId } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';

interface Props {
  open: boolean;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string;
  optionLabel?: string;
  optionDescription?: string;
  optionChecked?: boolean;
  onOptionCheckedChange?(checked: boolean): void;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}

export function DeleteEntityDialog({
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  busy,
  error,
  optionLabel,
  optionDescription,
  optionChecked,
  onOptionCheckedChange,
  onOpenChange,
  onConfirm,
}: Props) {
  const optionId = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-dialog="delete-entity">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </DialogHeader>
        {optionLabel && (
          <label htmlFor={optionId} className="flex cursor-pointer items-start gap-3 rounded-lg border bg-muted/40 p-3">
            <Checkbox
              id={optionId}
              className="mt-0.5"
              checked={optionChecked}
              disabled={busy}
              onCheckedChange={(checked) => onOptionCheckedChange?.(checked === true)}
            />
            <span className="grid gap-1 text-sm">
              <strong className="font-medium">{optionLabel}</strong>
              {optionDescription && (
                <small className="text-xs leading-relaxed text-muted-foreground">{optionDescription}</small>
              )}
            </span>
          </label>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            data-action="delete-entity-confirm"
            type="button"
            variant="destructive"
            disabled={busy}
            aria-busy={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
