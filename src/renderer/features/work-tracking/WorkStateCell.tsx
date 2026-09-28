import { useI18n } from '@/renderer/i18n/useI18n';
import { workItemStates, type WorkItem } from '@/shared/contracts/work-tracking';
import { WorkChoiceCell } from '@/renderer/features/work-tracking/WorkChoiceCell';
import { useWorkTableEditing } from '@/renderer/features/work-tracking/WorkTableEditing';

export function WorkStateCell({ item }: { item: WorkItem }) {
  const edit = useWorkTableEditing();
  const l = useI18n().messages.workTracking;
  return (
    <WorkChoiceCell
      label={l.state}
      value={item.state}
      display={item.enabled ? undefined : l.stopped}
      options={workItemStates}
      labels={l.states}
      version={edit.snapshot.revision}
      disabled={edit.busy}
      onSave={(state, revision) =>
        edit.mutate({ action: 'updateItem', itemId: item.id, fields: { state }, note: '' }, revision)
      }
    />
  );
}
