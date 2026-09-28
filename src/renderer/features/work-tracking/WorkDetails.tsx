import { Button } from '@/renderer/components/ui/button';
import { Badge } from '@/renderer/components/ui/badge';
import { useI18n } from '@/renderer/i18n/useI18n';
import { WorkExecutionResult } from '@/renderer/features/work-tracking/WorkExecutions';
import {
  workItemSchema,
  type WorkItem,
  type WorkTaskSummary,
  type WorkSnapshot,
  type WorkAttempt,
} from '@/shared/contracts/work-tracking';

function History({ snapshot, targetId }: { snapshot: WorkSnapshot; targetId: string }) {
  const l = useI18n().messages.workTracking;
  return (
    <div className="grid gap-2 text-sm">
      <strong>{l.history}</strong>
      {snapshot.history
        .filter((entry) => entry.targetId === targetId || entry.relatedItemIds?.includes(targetId))
        .slice(-12)
        .reverse()
        .map((entry) => {
          const parse = (value: string) => {
            try {
              return workItemSchema.safeParse(JSON.parse(value));
            } catch {
              return null;
            }
          };
          const before = parse(entry.before);
          const after = parse(entry.after);
          return (
            <div key={entry.requestId} className="grid gap-1 border-b border-border py-2">
              <div className="flex flex-wrap justify-between gap-2">
                <span>{l.actions[entry.action]}</span>
                <time className="text-xs text-muted-foreground">{new Date(entry.occurredAt).toLocaleString()}</time>
              </div>
              {before?.success && after?.success && before.data.state !== after.data.state && (
                <span>
                  {l.states[before.data.state]} → {l.states[after.data.state]}
                </span>
              )}
              {before?.success && after?.success && before.data.owner !== after.data.owner && (
                <span>
                  {l.owner}: {before.data.owner || l.noOwner} → {after.data.owner || l.noOwner}
                </span>
              )}
              {entry.action === 'assignTask' && (
                <span>
                  {entry.before} → {entry.after}
                </span>
              )}
              {entry.note && <span className="whitespace-pre-wrap break-words">{entry.note}</span>}
            </div>
          );
        })}
    </div>
  );
}

export function WorkItemDetails({
  item,
  snapshot,
  onEdit,
  onOpen,
  onDelegate,
  onTask,
  busy,
}: {
  item: WorkItem;
  snapshot: WorkSnapshot;
  onEdit(): void;
  onOpen(): void;
  onDelegate(): void;
  onTask(id: string): void;
  busy: boolean;
}) {
  const l = useI18n().messages.workTracking;
  const tasks = snapshot.tasks.filter((task) => task.inputs.some((input) => input.itemId === item.id));
  return (
    <div className="grid content-start gap-5 text-sm">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={onEdit}>
          {l.edit}
        </Button>
        <Button size="sm" variant="ghost" onClick={onOpen}>
          {l.openSource}
        </Button>
        <Button size="sm" disabled={busy || !item.enabled || item.state === 'CLOSED'} onClick={onDelegate}>
          {l.createTask}
        </Button>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="text-muted-foreground">{l.owner}</dt>
        <dd>{item.owner || l.noOwner}</dd>
        <dt className="text-muted-foreground">{l.state}</dt>
        <dd>{l.states[item.state]}</dd>
        {item.resolution && (
          <>
            <dt className="text-muted-foreground">{l.resolution}</dt>
            <dd>{l.resolutions[item.resolution]}</dd>
          </>
        )}
      </dl>
      {item.acceptance && (
        <div>
          <strong>{l.acceptance}</strong>
          <div className="mt-2 whitespace-pre-wrap break-words">{item.acceptance}</div>
        </div>
      )}
      {item.evidence && (
        <div>
          <strong>{l.evidence}</strong>
          <div className="mt-2 whitespace-pre-wrap break-words">{item.evidence}</div>
        </div>
      )}
      <div className="grid gap-2">
        <strong>
          {l.tasks} · {tasks.length}
        </strong>
        {tasks
          .slice(-20)
          .reverse()
          .map((task) => (
            <Button
              key={task.id}
              variant="link"
              className="h-auto justify-start whitespace-normal p-0 text-left"
              onClick={() => onTask(task.id)}
            >
              {task.objective} · {task.executor}
            </Button>
          ))}
      </div>
      {(snapshot.executions ?? [])
        .filter((entry) => entry.itemIds.includes(item.id))
        .slice()
        .reverse()
        .map((execution) => (
          <div key={execution.id} className="border-t border-border pt-3">
            <WorkExecutionResult execution={execution} />
          </div>
        ))}
      <History snapshot={snapshot} targetId={item.id} />
    </div>
  );
}

export function WorkTaskDetails({
  task,
  snapshot,
  articleRevisions,
  onCopy,
  onAssign,
  onRecord,
  onItem,
  busy,
}: {
  task: WorkTaskSummary;
  snapshot: WorkSnapshot;
  articleRevisions: Map<string, string>;
  onCopy(): void;
  onAssign(): void;
  onRecord(attempt?: WorkAttempt): void;
  onItem(id: string): void;
  busy: boolean;
}) {
  const l = useI18n().messages.workTracking;
  const attempts = snapshot.attempts.filter((attempt) => attempt.taskId === task.id);
  const active = attempts.find((attempt) => ['RUNNING', 'WAITING', 'UNKNOWN'].includes(attempt.state));
  return (
    <div className="grid content-start gap-5 text-sm">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={onCopy}>
          {l.copyHandoff}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onAssign}>
          {l.assignTask}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onRecord(active)}>
          {active ? l.updateAttempt : l.recordAttempt}
        </Button>
      </div>
      <div className="whitespace-pre-wrap break-words">{task.objective}</div>
      <div>
        {l.executor}: {task.executor}
      </div>
      <div className="grid gap-2">
        <strong>{l.fixedInputs}</strong>
        {task.inputs.map((input) => {
          const item = snapshot.items.find((entry) => entry.id === input.itemId);
          const changed =
            item?.revision !== input.itemRevision || articleRevisions.get(input.articleId) !== input.articleRevisionId;
          return (
            <div key={input.itemId} className="flex flex-wrap items-center gap-2">
              <Button
                variant="link"
                className="h-auto whitespace-normal p-0 text-left"
                onClick={() => onItem(input.itemId)}
              >
                {input.title || input.itemId}
              </Button>
              {changed && <Badge variant="outline">{l.inputChanged}</Badge>}
            </div>
          );
        })}
      </div>
      <div className="grid gap-3">
        <strong>
          {l.attempts} · {attempts.length}
        </strong>
        {!attempts.length && <span className="text-muted-foreground">{l.emptyAttempts}</span>}
        {attempts
          .slice(-20)
          .reverse()
          .map((attempt) => (
            <div key={attempt.id} className="grid gap-2 border-b border-border py-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{l.attemptStates[attempt.state]}</Badge>
                <span>{attempt.executor}</span>
                <span className="text-xs text-muted-foreground">
                  {l.manual} · {new Date(attempt.recordedAt).toLocaleString()}
                </span>
              </div>
              {attempt.result && <div className="whitespace-pre-wrap break-words">{attempt.result}</div>}
              {attempt.reference && <div className="break-all text-muted-foreground">{attempt.reference}</div>}
            </div>
          ))}
      </div>
      <History snapshot={snapshot} targetId={task.id} />
    </div>
  );
}
