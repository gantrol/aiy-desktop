import { Button } from '@/renderer/components/ui/button';
import { AuthorNames } from '@/renderer/features/me/AuthorNames';
import { useWorkTableEditing } from '@/renderer/features/work-tracking/WorkTableEditing';
import { WorkItemCells, WorkTitleCell } from '@/renderer/features/work-tracking/WorkItemCells';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { WorkItem, WorkTaskSummary, WorkAttempt } from '@/shared/contracts/work-tracking';
import { WorkItemExecutionRows } from '@/renderer/features/work-tracking/WorkItemExecutionRows';

export function WorkItemsTable({
  items,
  titles,
  selectedId,
  onSelect,
}: {
  items: WorkItem[];
  titles: Map<string, string>;
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const l = useI18n().messages.workTracking;
  const sourceLabel = useI18n().messages.creator.results.filterAuthor;
  const edit = useWorkTableEditing();
  return (
    <Table className="min-w-[62rem] table-fixed">
      <colgroup>
        <col />
        <col className="w-24" />
        <col className="w-28" />
        <col className="w-32" />
        <col className="w-24" />
        <col className="w-40" />
        <col className="w-28" />
      </colgroup>
      <TableHeader>
        <TableRow>
          {[l.title, l.kind, l.state, l.owner, l.priority, l.executions, sourceLabel].map((label) => (
            <TableHead key={label}>{label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <WorkItemExecutionRows
            key={item.id}
            itemId={item.id}
            title={titles.get(item.id) ?? l.untitled}
            selected={selectedId === item.id}
            colSpan={7}
            source={<AuthorNames authors={edit.article(item.articleId)?.authors} />}
          >
            <TableCell>
              <WorkTitleCell
                articleId={item.articleId}
                fallback={titles.get(item.id) ?? l.untitled}
                onOpen={() => onSelect(item.id)}
              />
            </TableCell>
            <WorkItemCells item={item} />
          </WorkItemExecutionRows>
        ))}
      </TableBody>
    </Table>
  );
}

export function WorkTasksTable({
  tasks,
  attempts,
  selectedId,
  onSelect,
}: {
  tasks: WorkTaskSummary[];
  attempts: WorkAttempt[];
  selectedId: string | null;
  onSelect(id: string): void;
}) {
  const l = useI18n().messages.workTracking;
  const latest = new Map<string, WorkAttempt>();
  for (const attempt of attempts) latest.set(attempt.taskId, attempt);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {[l.objective, l.executor, l.phase, l.state].map((label) => (
            <TableHead key={label}>{label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TableRow key={task.id} data-state={selectedId === task.id ? 'selected' : undefined}>
            <TableCell>
              <Button
                variant="link"
                className="h-auto max-w-80 justify-start whitespace-normal p-0 text-left"
                onClick={() => onSelect(task.id)}
              >
                {task.objective}
              </Button>
            </TableCell>
            <TableCell>{task.executor}</TableCell>
            <TableCell>{l.phases[task.phase]}</TableCell>
            <TableCell>{latest.has(task.id) ? l.attemptStates[latest.get(task.id)!.state] : l.noAttempt}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
