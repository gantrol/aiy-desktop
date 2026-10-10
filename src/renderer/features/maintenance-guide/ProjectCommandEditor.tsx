import { useId, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Label } from '@/renderer/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import { projectCommandSchema, projectCommandGroups, type ProjectCommand } from '@/shared/contracts/project-commands';

export function ProjectCommandEditor({
  initial,
  onChange,
  busy,
  onClose,
  onSave,
}: {
  initial: ProjectCommand;
  onChange(command: ProjectCommand): void;
  busy: boolean;
  onClose(): void;
  onSave(command: ProjectCommand): Promise<boolean>;
}) {
  const l = useI18n().messages.maintenanceGuide;
  const c = l.commands;
  const id = useId();
  const draft = initial;
  const setDraft = onChange;
  const [invalid, setInvalid] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto rounded-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{c.edit}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const parsed = projectCommandSchema.safeParse({ ...draft, edited: true });
            const valid =
              parsed.success && (draft.status !== 'ready' || Boolean(draft.command.trim() && draft.directory.trim()));
            setInvalid(!valid);
            if (valid && parsed.success)
              void onSave(parsed.data).then((saved) => {
                if (saved) onClose();
              });
          }}
        >
          {(['name', 'command', 'directory', 'tool', 'detail'] as const).map((field) => (
            <div key={field} className="grid gap-1">
              <Label htmlFor={`${id}-${field}`}>{c[field]}</Label>
              {field === 'command' || field === 'detail' ? (
                <Textarea
                  id={`${id}-${field}`}
                  value={draft[field]}
                  rows={3}
                  maxLength={field === 'command' ? 8000 : 12000}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                />
              ) : (
                <Input
                  id={`${id}-${field}`}
                  value={draft[field]}
                  required={field === 'name'}
                  maxLength={field === 'name' ? 200 : field === 'tool' ? 80 : 4096}
                  disabled={busy}
                  onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                />
              )}
            </div>
          ))}
          {(
            [
              ['group', projectCommandGroups, c.groups],
              ['platform', ['any', 'win32', 'darwin', 'linux'], c.platforms],
              ['shell', ['powershell', 'posix', 'cmd'], { powershell: 'PowerShell', posix: 'POSIX', cmd: 'cmd' }],
              ['status', ['ready', 'incomplete', 'changed', 'missing'], c.statuses],
            ] as const
          ).map(([field, values, labels]) => (
            <div key={field} className="grid gap-1">
              <Label htmlFor={`${id}-${field}`}>{c[field]}</Label>
              <Select
                value={draft[field]}
                disabled={busy}
                onValueChange={(value) => setDraft({ ...draft, [field]: value })}
              >
                <SelectTrigger id={`${id}-${field}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {values.map((value) => (
                    <SelectItem key={value} value={value}>
                      {(labels as Record<string, string>)[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
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
