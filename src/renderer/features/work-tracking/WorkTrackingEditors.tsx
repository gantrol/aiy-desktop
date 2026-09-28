import type { WorkAttempt, WorkItem, WorkSnapshot, WorkTaskSummary } from '@/shared/contracts/work-tracking';
import {
  TrackContentDialog,
  WorkItemEditor,
  type WorkEditorProps,
  type WorkSourceOption,
} from '@/renderer/features/work-tracking/WorkItemEditor';
import {
  WorkAssignmentEditor,
  WorkAttemptEditor,
  WorkTaskEditor,
} from '@/renderer/features/work-tracking/WorkTaskEditors';

export type WorkEditor = { revision: number } & (
  | { kind: 'track' }
  | { kind: 'item'; item: WorkItem }
  | { kind: 'task'; itemId?: string }
  | { kind: 'assign'; task: WorkTaskSummary }
  | { kind: 'attempt'; task: WorkTaskSummary; attempt?: WorkAttempt }
);

export function WorkTrackingEditors({
  editor,
  snapshot,
  titles,
  sources,
  taskItems,
  ...props
}: WorkEditorProps & {
  editor: WorkEditor | null;
  snapshot: WorkSnapshot;
  titles: Map<string, string>;
  sources: WorkSourceOption[];
  taskItems?: WorkItem[];
}) {
  if (!editor) return null;
  switch (editor.kind) {
    case 'track':
      return <TrackContentDialog {...props} sources={sources} />;
    case 'item':
      return <WorkItemEditor {...props} item={editor.item} items={snapshot.items} titles={titles} />;
    case 'task':
      return (
        <WorkTaskEditor {...props} items={taskItems ?? snapshot.items} titles={titles} initialItemId={editor.itemId} />
      );
    case 'assign':
      return <WorkAssignmentEditor {...props} task={editor.task} />;
    case 'attempt':
      return <WorkAttemptEditor {...props} task={editor.task} attempt={editor.attempt} />;
  }
}
