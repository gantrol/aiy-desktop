import { useState } from 'react';
import { Input } from '@/renderer/components/ui/input';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  workItemKinds,
  workItemStates,
  workResolutions,
  type WorkCommand,
  type WorkItem,
  type WorkItemFields,
} from '@/shared/contracts/work-tracking';
import { WorkDialog, WorkField, WorkSelect } from '@/renderer/features/work-tracking/WorkFields';

export interface WorkEditorProps {
  busy: boolean;
  error?: string;
  onClose(): void;
  onSave(command: WorkCommand): void;
}
export interface WorkSourceOption {
  authors?: import('@/shared/contracts/authorship').AuthorSummary[];
  itemId: string;
  formId: string;
  articleId: string;
  title: string;
}

export function TrackContentDialog({ sources, ...props }: WorkEditorProps & { sources: WorkSourceOption[] }) {
  const l = useI18n().messages.workTracking;
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('');
  const [kind, setKind] = useState<(typeof workItemKinds)[number]>('REQUIREMENT');
  const [owner, setOwner] = useState('');
  const options = sources
    .filter((source) => source.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
    .slice(0, 50);
  const source = sources.find((entry) => entry.formId === selected);
  return (
    <WorkDialog
      {...props}
      title={l.track}
      disabled={!source}
      onSave={() => {
        if (source)
          props.onSave({
            action: 'track',
            creationItemId: source.itemId,
            descriptionFormId: source.formId,
            kind,
            owner,
            note: '',
          });
      }}
    >
      <Input
        aria-label={l.search}
        placeholder={l.search}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <WorkField label={l.description}>
        <WorkSelect
          label={l.description}
          value={selected}
          values={options.map((entry) => entry.formId)}
          labels={Object.fromEntries(sources.map((entry) => [entry.formId, entry.title]))}
          onChange={setSelected}
        />
      </WorkField>
      {!options.length && (
        <div role="status" className="text-sm text-muted-foreground">
          {l.empty}
        </div>
      )}
      <WorkField label={l.kind}>
        <WorkSelect label={l.kind} value={kind} values={workItemKinds} labels={l.kinds} onChange={setKind} />
      </WorkField>
      <WorkField label={l.owner}>
        <Input value={owner} maxLength={120} onChange={(event) => setOwner(event.target.value)} />
      </WorkField>
    </WorkDialog>
  );
}

export function WorkItemEditor({
  item,
  items,
  titles,
  ...props
}: WorkEditorProps & { item: WorkItem; items: WorkItem[]; titles: Map<string, string> }) {
  const l = useI18n().messages.workTracking;
  const [fields, setFields] = useState<WorkItemFields>({
    kind: item.kind,
    state: item.state,
    owner: item.owner,
    priority: item.priority,
    acceptance: item.acceptance,
    enabled: item.enabled,
    resolution: item.resolution,
    duplicateOf: item.duplicateOf,
    evidence: item.evidence,
  });
  const [note, setNote] = useState('');
  const set = <K extends keyof WorkItemFields>(key: K, value: WorkItemFields[K]) =>
    setFields((old) => ({ ...old, [key]: value }));
  const duplicates = items.filter((entry) => entry.id !== item.id);
  return (
    <WorkDialog
      {...props}
      title={l.edit}
      onSave={() => props.onSave({ action: 'updateItem', itemId: item.id, fields, note })}
    >
      <div className="grid grid-cols-2 gap-3">
        <WorkField label={l.kind}>
          <WorkSelect
            label={l.kind}
            value={fields.kind}
            values={workItemKinds}
            labels={l.kinds}
            onChange={(value) => set('kind', value)}
          />
        </WorkField>
        <WorkField label={l.state}>
          <WorkSelect
            label={l.state}
            value={fields.state}
            values={workItemStates}
            labels={l.states}
            onChange={(state) =>
              setFields((old) => ({
                ...old,
                state,
                resolution: state === 'CLOSED' ? old.resolution : null,
                duplicateOf: null,
                evidence: '',
              }))
            }
          />
        </WorkField>
        <WorkField label={l.owner}>
          <Input value={fields.owner} maxLength={120} onChange={(event) => set('owner', event.target.value)} />
        </WorkField>
        <WorkField label={l.priority}>
          <WorkSelect
            label={l.priority}
            value={fields.priority}
            values={['NONE', 'HIGH', 'NORMAL', 'LOW']}
            labels={l.priorities}
            onChange={(value) => set('priority', value)}
          />
        </WorkField>
      </div>
      <WorkField label={l.acceptance}>
        <Textarea
          value={fields.acceptance}
          rows={4}
          maxLength={8000}
          onChange={(event) => set('acceptance', event.target.value)}
        />
      </WorkField>
      {fields.state === 'CLOSED' && (
        <>
          <WorkField label={l.resolution}>
            <WorkSelect
              label={l.resolution}
              value={fields.resolution ?? ''}
              values={workResolutions}
              labels={l.resolutions}
              onChange={(resolution) => setFields((old) => ({ ...old, resolution, duplicateOf: null }))}
            />
          </WorkField>
          {fields.resolution === 'DUPLICATE' && (
            <WorkField label={l.duplicateOf}>
              <WorkSelect
                label={l.duplicateOf}
                value={fields.duplicateOf ?? ''}
                values={duplicates.map((entry) => entry.id)}
                labels={Object.fromEntries(duplicates.map((entry) => [entry.id, titles.get(entry.id) ?? entry.id]))}
                onChange={(value) => set('duplicateOf', value)}
              />
            </WorkField>
          )}
          <WorkField label={l.evidence}>
            <Textarea
              value={fields.evidence}
              rows={3}
              maxLength={8000}
              onChange={(event) => set('evidence', event.target.value)}
            />
          </WorkField>
        </>
      )}
      <WorkField label={l.note}>
        <Input value={note} maxLength={8000} onChange={(event) => setNote(event.target.value)} />
      </WorkField>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={fields.enabled} onCheckedChange={(checked) => set('enabled', checked === true)} />
        {l.enabled}
      </label>
    </WorkDialog>
  );
}
