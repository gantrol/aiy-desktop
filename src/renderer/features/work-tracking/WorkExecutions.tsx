import type { WorkExecution } from '@/shared/contracts/work-tracking';
import { Button } from '@/renderer/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { useI18n } from '@/renderer/i18n/useI18n';
import { WorkExecutionLink } from '@/renderer/features/work-tracking/WorkExecutionLink';

export function WorkExecutionResult({ execution }: { execution: WorkExecution }) {
  const l = useI18n().messages.workTracking;
  return (
    <div className="grid gap-2 text-sm">
      <WorkExecutionLink reference={execution.reference} title={execution.title} />
      <div className="text-xs text-muted-foreground">
        {execution.executor.application} · {l.phases[execution.phase]} · {l.attemptStates[execution.state]}
      </div>
      <div className="whitespace-pre-wrap break-words">{execution.result}</div>
      {execution.linkNote && (
        <div>
          <span className="text-muted-foreground">{l.linkReason}: </span>
          {execution.linkNote}
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        {l.reportedBy}: {execution.recorder.application} ·{' '}
        <time>{new Date(execution.sourceUpdatedAt).toLocaleString()}</time>
      </div>
    </div>
  );
}

export function WorkExecutionsTable({
  executions,
  titles,
  onItem,
}: {
  executions: WorkExecution[];
  titles: Map<string, string>;
  onItem(id: string): void;
}) {
  const l = useI18n().messages.workTracking;
  return (
    <Table className="min-w-[48rem] table-fixed">
      <colgroup>
        <col />
        <col className="w-28" />
        <col className="w-28" />
        <col className="w-60" />
      </colgroup>
      <TableHeader>
        <TableRow>
          {[l.result, l.executor, l.state, l.items].map((label) => (
            <TableHead key={label}>{label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {executions.map((execution) => (
          <TableRow key={execution.id}>
            <TableCell>
              <WorkExecutionResult execution={execution} />
            </TableCell>
            <TableCell className="align-top">{execution.executor.application}</TableCell>
            <TableCell className="align-top">{l.attemptStates[execution.state]}</TableCell>
            <TableCell className="align-top">
              {execution.itemIds.length
                ? execution.itemIds.map((id) => (
                    <Button
                      key={id}
                      variant="link"
                      className="h-auto justify-start whitespace-normal p-0 text-left"
                      onClick={() => onItem(id)}
                    >
                      {titles.get(id) ?? l.noSource}
                    </Button>
                  ))
                : l.unlinked}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
