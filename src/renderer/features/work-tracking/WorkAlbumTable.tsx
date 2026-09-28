import { useEffect, useMemo, useState } from 'react';
import type { BootstrapDto } from '@/shared/contracts';
import type { WorkCommand, WorkItem, WorkSnapshot } from '@/shared/contracts/work-tracking';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { useI18n } from '@/renderer/i18n/useI18n';
import { WorkDialog, WorkField, WorkSelect } from '@/renderer/features/work-tracking/WorkFields';
import { WorkBulkEditor } from '@/renderer/features/work-tracking/WorkBulkEditor';
import { albumWorkRows } from '@/renderer/features/work-tracking/albumWorkRows';
import { WorkAlbumRows } from '@/renderer/features/work-tracking/WorkAlbumRows';
import type { WorkFilters } from '@/renderer/features/work-tracking/WorkTrackingToolbar';

export function WorkAlbumTable({
  data,
  albumId,
  snapshot,
  filters,
  busy,
  error,
  onMutate,
  onSelect,
}: {
  data: BootstrapDto;
  albumId: string;
  snapshot: WorkSnapshot;
  filters: WorkFilters;
  busy: boolean;
  error?: string;
  onMutate(command: WorkCommand, revision: number): Promise<boolean>;
  onSelect(id: string, articleId: string): void;
}) {
  const l = useI18n().messages.workTracking;
  const [choices, setChoices] = useState<Record<string, string>>({});
  const rows = useMemo(
    () => albumWorkRows(data, albumId, snapshot, filters, l.noSource, l.untitled, choices),
    [data, albumId, snapshot, filters, l.noSource, l.untitled, choices],
  );
  const [selected, setSelected] = useState(new Set<string>());
  useEffect(() => {
    const visible = new Set(rows.map((row) => row.id));
    setSelected((old) => {
      const next = new Set([...old].filter((id) => visible.has(id)));
      return next.size === old.size ? old : next;
    });
  }, [rows]);
  const [page, setPage] = useState(0);
  const [owner, setOwner] = useState('');
  const [initialState, setInitialState] = useState<'DRAFT' | 'TRIAGE' | 'BACKLOG'>('TRIAGE');
  const [editing, setEditing] = useState<{ itemIds: string[]; revision: number } | null>(null);
  const [batch, setBatch] = useState<{
    command: Extract<WorkCommand, { action: 'trackBatch' }>;
    revision: number;
  } | null>(null);
  const selectedRows = rows.filter((row) => selected.has(row.id) && !row.item);
  const trackedRows = rows.filter((row) => selected.has(row.id) && row.item);
  const valid =
    selectedRows.length > 0 &&
    selectedRows.every((row) => row.sources.some((source) => source.formId === (choices[row.id] ?? row.defaultFormId)));
  const total = Math.max(1, Math.ceil(rows.length / 40));
  const current = Math.min(page, total - 1);
  const eligible = rows.filter((row) => row.item || row.sources.length);
  const prepare = (kind: WorkItem['kind']) => {
    setOwner('');
    setInitialState('TRIAGE');
    setBatch({
      revision: snapshot.revision,
      command: {
        action: 'trackBatch',
        albumId,
        kind,
        owner: '',
        note: '',
        entries: selectedRows.map((row) => ({
          creationItemId: row.id,
          descriptionFormId: choices[row.id] ?? row.defaultFormId,
        })),
      },
    });
  };
  const save = async () => {
    if (batch && (await onMutate({ ...batch.command, owner, initialState }, batch.revision))) {
      setBatch(null);
      setSelected(
        (old) => new Set([...old].filter((id) => !batch.command.entries.some((entry) => entry.creationItemId === id))),
      );
    }
  };
  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={busy || !eligible.length}
          onClick={() => setSelected(new Set(eligible.slice(0, 100).map((row) => row.id)))}
        >
          {l.selectMatching}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy || !selected.size} onClick={() => setSelected(new Set())}>
          {l.clearSelection}
        </Button>
        <span className="text-xs tabular-nums">
          {l.selected} · {selected.size}
        </span>
        {selectedRows.length > 0 && (
          <>
            <Button size="sm" disabled={busy || !valid} onClick={() => prepare('REQUIREMENT')}>
              {l.asRequirement} · {selectedRows.length}
            </Button>
            <Button variant="outline" size="sm" disabled={busy || !valid} onClick={() => prepare('BUG')}>
              {l.asBug} · {selectedRows.length}
            </Button>
          </>
        )}
        {trackedRows.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setEditing({ itemIds: trackedRows.map((row) => row.id), revision: snapshot.revision })}
          >
            {l.editSelected} · {trackedRows.length}
          </Button>
        )}
      </div>
      <WorkAlbumRows
        albumId={albumId}
        rows={rows.slice(current * 40, (current + 1) * 40)}
        selected={selected}
        choices={choices}
        busy={busy}
        onToggle={(id, checked) =>
          setSelected((old) => {
            const next = new Set(old);
            if (checked) next.add(id);
            else next.delete(id);
            return next;
          })
        }
        onChoose={(id, formId) => setChoices((old) => ({ ...old, [id]: formId }))}
        onSelect={onSelect}
      />
      {!rows.length && (
        <div role="status" className="py-6 text-center text-sm text-muted-foreground">
          {l.empty}
        </div>
      )}
      <div className="flex items-center justify-end gap-2 text-xs">
        <span>
          {l.total} · {rows.length}
        </span>
        <Button variant="ghost" disabled={!current || busy} onClick={() => setPage(current - 1)}>
          {l.previous}
        </Button>
        <span>
          {current + 1} / {total}
        </span>
        <Button variant="ghost" disabled={current + 1 >= total || busy} onClick={() => setPage(current + 1)}>
          {l.next}
        </Button>
      </div>
      {batch && (
        <WorkDialog
          title={`${l.actions.trackBatch} · ${l.kinds[batch.command.kind]} · ${batch.command.entries.length}`}
          busy={busy}
          error={error}
          onClose={() => setBatch(null)}
          onSave={() => void save()}
        >
          <WorkField label={l.state}>
            <WorkSelect
              label={l.state}
              value={initialState}
              values={['DRAFT', 'TRIAGE', 'BACKLOG'] as const}
              labels={l.states}
              onChange={setInitialState}
            />
          </WorkField>
          <WorkField label={l.owner}>
            <Input value={owner} maxLength={120} onChange={(event) => setOwner(event.target.value)} />
          </WorkField>
        </WorkDialog>
      )}
      {editing && (
        <WorkBulkEditor
          {...editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setSelected((old) => new Set([...old].filter((id) => !editing.itemIds.includes(id))));
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
