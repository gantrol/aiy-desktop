import { useState } from 'react';
import type { PromptVersionDto } from '@/shared/contracts';
import type { ImportVersionAssignment } from '@/renderer/components/creator/imageImport';
import { usePromptVersionLabel } from '@/renderer/components/creator/usePromptVersionLabel';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';

const unlinked = '__unlinked__';
const createVersion = '__create__';

export function importVersionValue(version: ImportVersionAssignment) {
  return version.newVersionNo === undefined ? (version.promptVersionId ?? unlinked) : `new:${version.newVersionNo}`;
}

function parseVersionValue(value: string): ImportVersionAssignment {
  if (value.startsWith('new:')) return { promptVersionId: null, newVersionNo: Number(value.slice(4)) };
  return { promptVersionId: value === unlinked ? null : value };
}

interface Props {
  value: string;
  versions: readonly PromptVersionDto[];
  pendingVersionNos: readonly number[];
  disabled: boolean;
  label: string;
  onChange(version: ImportVersionAssignment): void;
  onCreate(): void;
}

export function ImportVersionSelect({
  value,
  versions,
  pendingVersionNos,
  disabled,
  label,
  onChange,
  onCreate,
}: Props) {
  const labels = useI18n().messages.creator.workbench;
  const versionLabel = usePromptVersionLabel();
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === createVersion) onCreate();
        else onChange(parseVersionValue(next));
      }}
    >
      <SelectTrigger className="h-8 min-w-40 text-xs" aria-label={label}>
        <SelectValue placeholder={labels.mixedVersions} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={unlinked}>{labels.unlinkedVersion}</SelectItem>
        {versions.map((version) => (
          <SelectItem key={version.id} value={version.id}>
            {versionLabel(version)}
          </SelectItem>
        ))}
        {pendingVersionNos.map((versionNo) => (
          <SelectItem key={versionNo} value={`new:${versionNo}`}>
            {labels.pendingVersion(`V${String(versionNo).padStart(2, '0')}`)}
          </SelectItem>
        ))}
        <SelectItem value={createVersion}>{labels.newImportVersion}</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function NewImportVersionDialog({
  initialVersionNo,
  versions,
  onAssign,
  onClose,
}: {
  initialVersionNo: number;
  versions: readonly PromptVersionDto[];
  onAssign(version: ImportVersionAssignment): void;
  onClose(): void;
}) {
  const labels = useI18n().messages.creator.workbench;
  const [number, setNumber] = useState(String(initialVersionNo));
  const versionNo = Number(number);
  const valid = /^\d+$/.test(number) && Number.isSafeInteger(versionNo) && versionNo >= 1 && versionNo <= 999999;
  const existing = valid ? versions.find((version) => version.versionNo === versionNo) : undefined;
  const versionLabel = `V${String(valid ? versionNo : initialVersionNo).padStart(2, '0')}`;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            onAssign(existing ? { promptVersionId: existing.id } : { promptVersionId: null, newVersionNo: versionNo });
            onClose();
          }}
        >
          <DialogHeader>
            <DialogTitle>{labels.newImportVersion}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="import-version-number">{labels.importVersionNumber}</Label>
            <Input
              id="import-version-number"
              inputMode="numeric"
              autoFocus
              value={number}
              maxLength={6}
              aria-invalid={!valid}
              onChange={(event) => setNumber(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {labels.cancel}
            </Button>
            <Button type="submit" disabled={!valid}>
              {existing ? labels.linkImportVersion(versionLabel) : labels.createImportVersion(versionLabel)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
