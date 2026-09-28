import { useState } from 'react';
import { Input } from '@/renderer/components/ui/input';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  workPhases,
  workAttemptStates,
  type WorkItem,
  type WorkTaskSummary,
  type WorkAttempt,
} from '@/shared/contracts/work-tracking';
import { WorkDialog, WorkField, WorkSelect } from '@/renderer/features/work-tracking/WorkFields';
import type { WorkEditorProps } from '@/renderer/features/work-tracking/WorkItemEditor';

export function WorkTaskEditor({
  items,
  titles,
  initialItemId,
  ...props
}: WorkEditorProps & { items: WorkItem[]; titles: Map<string, string>; initialItemId?: string }) {
  const l = useI18n().messages.workTracking;
  const [selected, setSelected] = useState<string[]>(initialItemId ? [initialItemId] : []);
  const [search, setSearch] = useState('');
  const [objective, setObjective] = useState('');
  const [executor, setExecutor] = useState('');
  const [constraints, setConstraints] = useState('');
  const [phase, setPhase] = useState<(typeof workPhases)[number]>('expression');
  const options = items
    .filter(
      (item) =>
        item.enabled &&
        item.state !== 'CLOSED' &&
        (titles.get(item.id) ?? item.id).toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    )
    .slice(0, 50);
  return (
    <WorkDialog
      {...props}
      title={l.createTask}
      disabled={!selected.length || !objective.trim() || !executor.trim()}
      onSave={() =>
        props.onSave({ action: 'createTask', itemIds: selected, objective, executor, constraints, phase, note: '' })
      }
    >
      <WorkField label={l.objective}>
        <Textarea
          required
          rows={3}
          maxLength={8000}
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
        />
      </WorkField>
      <div className="grid grid-cols-2 gap-3">
        <WorkField label={l.executor}>
          <Input required maxLength={120} value={executor} onChange={(event) => setExecutor(event.target.value)} />
        </WorkField>
        <WorkField label={l.phase}>
          <WorkSelect label={l.phase} value={phase} values={workPhases} labels={l.phases} onChange={setPhase} />
        </WorkField>
      </div>
      <WorkField label={l.constraints}>
        <Textarea
          rows={2}
          maxLength={8000}
          value={constraints}
          onChange={(event) => setConstraints(event.target.value)}
        />
      </WorkField>
      <div className="grid gap-2">
        <span className="text-sm text-muted-foreground">
          {l.linkedItems} · {selected.length}
        </span>
        <Input
          aria-label={l.search}
          placeholder={l.search}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="grid max-h-48 gap-2 overflow-y-auto">
          {options.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(item.id)}
                disabled={selected.length >= 8 && !selected.includes(item.id)}
                onCheckedChange={(checked) =>
                  setSelected((old) => (checked === true ? [...old, item.id] : old.filter((id) => id !== item.id)))
                }
              />
              <span className="truncate">{titles.get(item.id) ?? item.id}</span>
            </label>
          ))}
        </div>
      </div>
    </WorkDialog>
  );
}

export function WorkAssignmentEditor({ task, ...props }: WorkEditorProps & { task: WorkTaskSummary }) {
  const l = useI18n().messages.workTracking;
  const [executor, setExecutor] = useState(task.executor);
  const [note, setNote] = useState('');
  return (
    <WorkDialog
      {...props}
      title={l.assignTask}
      disabled={!executor.trim()}
      onSave={() => props.onSave({ action: 'assignTask', taskId: task.id, executor, note })}
    >
      <WorkField label={l.executor}>
        <Input required maxLength={120} value={executor} onChange={(event) => setExecutor(event.target.value)} />
      </WorkField>
      <WorkField label={l.note}>
        <Input maxLength={8000} value={note} onChange={(event) => setNote(event.target.value)} />
      </WorkField>
    </WorkDialog>
  );
}

export function WorkAttemptEditor({
  task,
  attempt,
  ...props
}: WorkEditorProps & { task: WorkTaskSummary; attempt?: WorkAttempt }) {
  const l = useI18n().messages.workTracking;
  const [state, setState] = useState<WorkAttempt['state']>(attempt?.state ?? 'RUNNING');
  const [result, setResult] = useState(attempt?.result ?? '');
  const [reference, setReference] = useState(attempt?.reference ?? '');
  return (
    <WorkDialog
      {...props}
      title={attempt ? l.updateAttempt : l.recordAttempt}
      onSave={() =>
        props.onSave(
          attempt
            ? { action: 'updateAttempt', attemptId: attempt.id, state, result, reference, note: '' }
            : { action: 'recordAttempt', taskId: task.id, state, result, reference, note: '' },
        )
      }
    >
      <div className="flex flex-wrap gap-3 text-sm">
        <span>{l.manual}</span>
        <span>
          {l.executor}: {attempt?.executor ?? task.executor}
        </span>
      </div>
      <WorkField label={l.state}>
        <WorkSelect
          label={l.state}
          value={state}
          values={workAttemptStates}
          labels={l.attemptStates}
          onChange={setState}
        />
      </WorkField>
      <WorkField label={l.result}>
        <Textarea
          value={result}
          required={['SUCCEEDED', 'FAILED', 'CANCELED'].includes(state)}
          maxLength={8000}
          rows={5}
          onChange={(event) => setResult(event.target.value)}
        />
      </WorkField>
      <WorkField label={l.reference}>
        <Input value={reference} maxLength={2000} onChange={(event) => setReference(event.target.value)} />
      </WorkField>
    </WorkDialog>
  );
}
