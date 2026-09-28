import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useWorkTableEditing } from '@/renderer/features/work-tracking/WorkTableEditing';
import { WorkExecutionLink } from '@/renderer/features/work-tracking/WorkExecutionLink';
import type { ItemExecution } from '@/renderer/features/work-tracking/workItemExecutions';

function ExecutionRows({ entries, title }: { entries: ItemExecution[]; title: string }) {
  const l = useI18n().messages.workTracking;
  const [page, setPage] = useState(0);
  const total = Math.max(1, Math.ceil(entries.length / 10));
  const current = Math.min(page, total - 1);
  return (
    <div className="grid gap-2">
      <Table className="table-fixed text-xs" aria-label={`${l.executions}: ${title}`}>
        <colgroup>
          <col />
          <col className="w-28" />
          <col className="w-32" />
          <col className="w-44" />
          <col className="w-12" />
        </colgroup>
        <TableHeader>
          <TableRow>
            {[l.execution, l.executor, l.state, l.updatedAt].map((label) => (
              <TableHead key={label} className="h-8 text-xs">
                {label}
              </TableHead>
            ))}
            <TableHead>
              <span className="sr-only">{l.openExecution}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.slice(current * 10, (current + 1) * 10).map((entry) => (
            <TableRow key={entry.id}>
              <TableCell>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="link"
                      className="h-auto max-w-full justify-start whitespace-normal p-0 text-left text-xs"
                    >
                      {entry.title}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="max-h-80 w-96 max-w-[calc(100vw-2rem)] space-y-3 overflow-auto text-sm"
                  >
                    <div className="font-medium">{entry.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {entry.executor} · {l.phases[entry.phase]} · {l.attemptStates[entry.state]}
                    </div>
                    {entry.result && <div className="whitespace-pre-wrap break-words">{entry.result}</div>}
                    {entry.linkNote && (
                      <div className="whitespace-pre-wrap break-words">
                        <span className="text-muted-foreground">{l.linkReason}: </span>
                        {entry.linkNote}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </TableCell>
              <TableCell className="break-words">{entry.executor}</TableCell>
              <TableCell>{l.attemptStates[entry.state]}</TableCell>
              <TableCell className="tabular-nums">
                <time dateTime={entry.updatedAt}>{new Date(entry.updatedAt).toLocaleString()}</time>
              </TableCell>
              <TableCell>
                {entry.reference && <WorkExecutionLink reference={entry.reference} title={entry.title} compact />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {total > 1 && (
        <div className="flex items-center justify-end gap-2 text-xs">
          <Button variant="ghost" size="xs" disabled={!current} onClick={() => setPage(current - 1)}>
            {l.previous}
          </Button>
          <span className="tabular-nums">
            {current + 1} / {total}
          </span>
          <Button variant="ghost" size="xs" disabled={current + 1 >= total} onClick={() => setPage(current + 1)}>
            {l.next}
          </Button>
        </div>
      )}
    </div>
  );
}

export function WorkItemExecutionRows({
  itemId,
  title,
  selected,
  colSpan,
  children,
  source,
}: {
  itemId: string;
  title: string;
  selected: boolean;
  colSpan: number;
  children: ReactNode;
  source: ReactNode;
}) {
  const l = useI18n().messages.workTracking;
  const { executionsByItem } = useWorkTableEditing();
  const entries = executionsByItem.get(itemId) ?? [];
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const running = entries.filter((entry) => entry.state === 'RUNNING').length;
  const waiting = entries.filter((entry) => entry.state === 'WAITING').length;
  const count = l.executionCount.replace('{count}', String(entries.length));
  const status =
    [
      running ? l.runningExecutions.replace('{count}', String(running)) : '',
      waiting ? l.waitingExecutions.replace('{count}', String(waiting)) : '',
    ]
      .filter(Boolean)
      .join(' · ') || (entries[0] ? l.latestExecutionState.replace('{state}', l.attemptStates[entries[0].state]) : '');
  return (
    <>
      <TableRow data-state={selected ? 'selected' : undefined}>
        {children}
        <TableCell>
          {entries.length ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-auto max-w-full justify-start gap-1.5 px-1 py-1 text-xs"
              aria-expanded={open}
              aria-controls={detailsId}
              aria-label={`${l.executions}: ${title} · ${count} · ${status}`}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
              <span className="min-w-0 text-left">
                <span className="block tabular-nums">{count}</span>
                <span className="block whitespace-normal text-muted-foreground">{status}</span>
              </span>
            </Button>
          ) : (
            <span className="text-muted-foreground" aria-label={l.noAttempt}>
              —
            </span>
          )}
        </TableCell>
        <TableCell>{source}</TableCell>
      </TableRow>
      {open && entries.length > 0 && (
        <TableRow id={detailsId} className="bg-muted/20 hover:bg-muted/20">
          <TableCell colSpan={colSpan} className="px-6 py-2">
            <ExecutionRows entries={entries} title={title} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
