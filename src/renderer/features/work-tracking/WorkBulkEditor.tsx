import { useState } from 'react';
import { Input } from '@/renderer/components/ui/input';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { useI18n } from '@/renderer/i18n/useI18n';
import { workItemKinds, type WorkCommand } from '@/shared/contracts/work-tracking';
import { WorkDialog, WorkField, WorkSelect } from '@/renderer/features/work-tracking/WorkFields';
import { useWorkTableEditing } from '@/renderer/features/work-tracking/WorkTableEditing';

type Fields = Extract<WorkCommand, { action: 'updateItems' }>['fields'];
export function WorkBulkEditor({
  itemIds,
  revision,
  onClose,
  onSaved,
}: {
  itemIds: string[];
  revision: number;
  onClose(): void;
  onSaved(): void;
}) {
  const l = useI18n().messages.workTracking;
  const edit = useWorkTableEditing();
  const [fields, setFields] = useState<Fields>({});
  const toggle = (key: keyof Fields, checked: boolean) =>
    setFields((old) => {
      const next = { ...old };
      if (!checked) delete next[key];
      else Object.assign(next, { [key]: { kind: 'REQUIREMENT', owner: '', priority: 'NONE' }[key] });
      return next;
    });
  const save = async () => {
    if (await edit.mutate({ action: 'updateItems', itemIds, fields, note: '' }, revision)) onSaved();
  };
  return (
    <WorkDialog
      title={`${l.editSelected} · ${itemIds.length}`}
      busy={edit.busy}
      error={edit.error}
      onClose={onClose}
      onSave={() => void save()}
      disabled={!Object.keys(fields).length}
    >
      {(['kind', 'owner', 'priority'] as const).map((key) => (
        <div key={key} className="grid grid-cols-[auto_1fr] items-center gap-3">
          <Checkbox
            aria-label={`${l.applyField}: ${l[key]}`}
            checked={fields[key] !== undefined}
            onCheckedChange={(checked) => toggle(key, checked === true)}
          />
          <WorkField label={l[key]}>
            {key === 'kind' ? (
              <WorkSelect
                label={l.kind}
                value={fields.kind ?? 'REQUIREMENT'}
                values={workItemKinds}
                labels={l.kinds}
                disabled={fields.kind === undefined}
                onChange={(kind) => setFields((old) => ({ ...old, kind }))}
              />
            ) : key === 'owner' ? (
              <Input
                value={fields.owner ?? ''}
                disabled={fields.owner === undefined}
                maxLength={120}
                onChange={(event) => setFields((old) => ({ ...old, owner: event.target.value }))}
              />
            ) : (
              <WorkSelect
                label={l.priority}
                value={fields.priority ?? 'NONE'}
                values={['NONE', 'HIGH', 'NORMAL', 'LOW'] as const}
                labels={l.priorities}
                disabled={fields.priority === undefined}
                onChange={(priority) => setFields((old) => ({ ...old, priority }))}
              />
            )}
          </WorkField>
        </div>
      ))}
    </WorkDialog>
  );
}
