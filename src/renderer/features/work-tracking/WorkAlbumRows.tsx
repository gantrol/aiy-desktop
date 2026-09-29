import { Checkbox } from '@/renderer/components/ui/checkbox';
import { AuthorNames } from '@/renderer/features/me/AuthorNames';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { useI18n } from '@/renderer/i18n/useI18n';
import { WorkSelect } from '@/renderer/features/work-tracking/WorkFields';
import type { AlbumWorkRow } from '@/renderer/features/work-tracking/albumWorkRows';
import { workItemKinds } from '@/shared/contracts/work-tracking';
import { WorkChoiceCell } from '@/renderer/features/work-tracking/WorkChoiceCell';
import { WorkItemCells, WorkTitleCell } from '@/renderer/features/work-tracking/WorkItemCells';
import { useWorkTableEditing } from '@/renderer/features/work-tracking/WorkTableEditing';
import { WorkItemExecutionRows } from '@/renderer/features/work-tracking/WorkItemExecutionRows';

export function WorkAlbumRows({
  rows,
  albumId,
  selected,
  choices,
  busy,
  onToggle,
  onChoose,
  onSelect,
}: {
  rows: AlbumWorkRow[];
  albumId: string;
  selected: Set<string>;
  choices: Record<string, string>;
  busy: boolean;
  onToggle(id: string, checked: boolean): void;
  onChoose(id: string, formId: string): void;
  onSelect(id: string, articleId: string): void;
}) {
  const l = useI18n().messages.workTracking;
  const sourceLabel = useI18n().messages.creator.results.filterAuthor;
  const edit = useWorkTableEditing();
  return (
    <Table className="min-w-[66rem] table-fixed">
      <colgroup>
        <col className="w-14" />
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
          {[l.select, l.title, l.kind, l.state, l.owner, l.priority, l.executions, sourceLabel].map((label) => (
            <TableHead key={label}>{label}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const source = row.sources.find((entry) => entry.formId === (choices[row.id] ?? row.defaultFormId));
          const articleId = row.item?.articleId ?? source?.articleId;
          return (
            <WorkItemExecutionRows
              key={row.id}
              itemId={row.id}
              title={row.title}
              selected={selected.has(row.id)}
              colSpan={8}
              source={<AuthorNames authors={articleId ? edit.article(articleId)?.authors : undefined} />}
            >
              <TableCell>
                <Checkbox
                  aria-label={`${l.select}: ${row.title}`}
                  checked={selected.has(row.id)}
                  disabled={
                    busy || (!row.item && !row.sources.length) || (selected.size >= 100 && !selected.has(row.id))
                  }
                  onCheckedChange={(checked) => onToggle(row.id, checked === true)}
                />
              </TableCell>
              <TableCell>
                {articleId ? (
                  <WorkTitleCell
                    key={articleId}
                    articleId={articleId}
                    fallback={row.title}
                    onOpen={() => onSelect(row.id, articleId)}
                  />
                ) : (
                  <span className="whitespace-normal">{row.title}</span>
                )}
                {!row.item && row.sources.length > 1 && (
                  <WorkSelect
                    label={l.description}
                    value={choices[row.id] ?? row.defaultFormId}
                    values={row.sources.map((entry) => entry.formId)}
                    labels={Object.fromEntries(row.sources.map((entry) => [entry.formId, entry.title]))}
                    onChange={(formId) => onChoose(row.id, formId)}
                    disabled={busy}
                  />
                )}
              </TableCell>
              {row.item ? (
                <WorkItemCells item={row.item} />
              ) : (
                <>
                  <TableCell>
                    <WorkChoiceCell
                      label={l.kind}
                      value=""
                      display={row.sources.length ? l.untracked : l.articleRequired}
                      options={workItemKinds}
                      labels={l.kinds}
                      version={edit.snapshot.revision}
                      disabled={busy || !source}
                      onSave={(kind, revision) =>
                        edit.mutate(
                          {
                            action: 'trackBatch',
                            albumId,
                            entries: [{ creationItemId: row.id, descriptionFormId: source!.formId }],
                            kind,
                            owner: '',
                            initialState: 'TRIAGE',
                            note: '',
                          },
                          revision,
                        )
                      }
                    />
                  </TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell />
                </>
              )}
            </WorkItemExecutionRows>
          );
        })}
      </TableBody>
    </Table>
  );
}
