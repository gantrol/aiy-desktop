import { useId, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { maintenanceProjectDraftSchema, type MaintenanceProjectDraft } from '@/shared/contracts/maintenance-guide';

interface Props {
  initial: MaintenanceProjectDraft;
  busy: boolean;
  onClose(): void;
  onSave(draft: MaintenanceProjectDraft): Promise<boolean>;
}

export function MaintenanceProjectEditor({ initial, busy, onClose, onSave }: Props) {
  const l = useI18n().messages.maintenanceGuide;
  const id = useId();
  const [draft, setDraft] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const fields = ['name', 'website', 'release'] as const;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto rounded-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{l.editProject}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = maintenanceProjectDraftSchema.safeParse(draft);
            setInvalid(!parsed.success);
            if (parsed.success)
              void onSave(parsed.data).then((saved) => {
                if (saved) onClose();
              });
          }}
        >
          {fields.map((field) => (
            <div key={field} className="grid gap-1.5">
              <Label htmlFor={`${id}-${field}`}>{l[field]}</Label>
              <Input
                id={`${id}-${field}`}
                value={draft[field]}
                maxLength={field === 'website' ? 4096 : 120}
                required={field === 'name'}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
              />
            </div>
          ))}
          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-notes`}>{l.notes}</Label>
            <Textarea
              id={`${id}-notes`}
              value={draft.notes}
              maxLength={20000}
              rows={12}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
            />
          </div>
          {invalid && (
            <div role="alert" className="text-sm text-destructive">
              {l.errors.invalidInput}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              {l.cancel}
            </Button>
            <Button type="submit" disabled={busy}>
              {l.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
