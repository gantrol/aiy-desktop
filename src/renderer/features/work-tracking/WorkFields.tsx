import type { ReactNode } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';

export function WorkField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function WorkSelect<T extends string>({
  label,
  value,
  values,
  labels,
  onChange,
  disabled,
}: {
  label: string;
  value: NoInfer<T> | '';
  values: readonly T[];
  labels: Record<NoInfer<T>, string>;
  onChange(value: NoInfer<T>): void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as T)} disabled={disabled}>
      <SelectTrigger aria-label={label} className="w-full min-w-32">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {values.map((option) => (
          <SelectItem key={option} value={option}>
            {labels[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function WorkDialog({
  title,
  busy,
  error,
  children,
  onClose,
  onSave,
  disabled,
}: {
  title: string;
  busy: boolean;
  error?: string;
  children: ReactNode;
  onClose(): void;
  onSave(): void;
  disabled?: boolean;
}) {
  const l = useI18n().messages.workTracking;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-md sm:max-w-xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && !disabled) onSave();
          }}
        >
          <fieldset disabled={busy} className="grid min-w-0 gap-4">
            {children}
          </fieldset>
          {error && (
            <div role="alert" className="text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              {l.cancel}
            </Button>
            <Button type="submit" disabled={busy || disabled}>
              {l.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
