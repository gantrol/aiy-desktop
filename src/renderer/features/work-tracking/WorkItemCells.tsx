import { TableCell } from '@/renderer/components/ui/table';
import { useI18n } from '@/renderer/i18n/useI18n';
import { workItemKinds, type WorkItem } from '@/shared/contracts/work-tracking';
import { WorkChoiceCell } from '@/renderer/features/work-tracking/WorkChoiceCell';
import { WorkStateCell } from '@/renderer/features/work-tracking/WorkStateCell';
import { WorkTextCell } from '@/renderer/features/work-tracking/WorkTextCell';
import { useWorkTableEditing } from '@/renderer/features/work-tracking/WorkTableEditing';

export function WorkItemCells({ item }: { item: WorkItem }) {
  const l = useI18n().messages.workTracking;
  const edit = useWorkTableEditing();
  return (
    <>
      <TableCell>
        <WorkChoiceCell
          label={l.kind}
          value={item.kind}
          options={workItemKinds}
          labels={l.kinds}
          version={edit.snapshot.revision}
          disabled={edit.busy}
          onSave={(kind, revision) =>
            edit.mutate({ action: 'updateItem', itemId: item.id, fields: { kind }, note: '' }, revision)
          }
        />
      </TableCell>
      <TableCell>
        <WorkStateCell item={item} />
      </TableCell>
      <TableCell>
        <WorkTextCell
          label={l.owner}
          value={item.owner}
          display={item.owner || l.noOwner}
          version={edit.snapshot.revision}
          disabled={edit.busy}
          maxLength={120}
          onSave={async (owner, revision) =>
            (await edit.mutate(
              { action: 'updateItem', itemId: item.id, fields: { owner }, note: '' },
              Number(revision),
            ))
              ? null
              : l.cellSaveFailed
          }
        />
      </TableCell>
      <TableCell>
        <WorkChoiceCell
          label={l.priority}
          value={item.priority}
          options={['NONE', 'HIGH', 'NORMAL', 'LOW'] as const}
          labels={l.priorities}
          version={edit.snapshot.revision}
          disabled={edit.busy}
          onSave={(priority, revision) =>
            edit.mutate({ action: 'updateItem', itemId: item.id, fields: { priority }, note: '' }, revision)
          }
        />
      </TableCell>
    </>
  );
}

export function WorkTitleCell({
  articleId,
  fallback,
  onOpen,
}: {
  articleId: string;
  fallback: string;
  onOpen(): void;
}) {
  const l = useI18n().messages.workTracking;
  const edit = useWorkTableEditing();
  const article = edit.article(articleId);
  return (
    <WorkTextCell
      label={l.title}
      value={article?.content.title ?? ''}
      display={article?.content.title || fallback || l.untitled}
      version={article?.revisionId ?? ''}
      disabled={edit.busy || !article}
      maxLength={200}
      onOpen={onOpen}
      onSave={(title, version) =>
        title.trim() ? edit.rename(articleId, title, String(version)) : Promise.resolve(l.titleRequired)
      }
    />
  );
}
