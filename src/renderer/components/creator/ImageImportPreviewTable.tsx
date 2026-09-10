import { ArrowDownIcon, ArrowUpIcon, CheckIcon, CopyIcon, ImageIcon, Trash2Icon, XIcon } from 'lucide-react';
import type { PromptVersionDto } from '@/shared/contracts';
import type { ImportVersionAssignment, RendererImageImportPreviewRow } from '@/renderer/components/creator/imageImport';
import { ImportVersionSelect, importVersionValue } from '@/renderer/components/creator/ImportVersionSelect';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Input } from '@/renderer/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  rows: RendererImageImportPreviewRow[];
  versions: readonly PromptVersionDto[];
  pendingVersionNos: readonly number[];
  selectedIds: ReadonlySet<string>;
  selectedCount: number;
  readyCount: number;
  allReadySelected: boolean;
  clock: number;
  busy: boolean;
  onToggleAll(checked: boolean): void;
  onToggleRow(rowId: string, checked: boolean): void;
  onCreateVersion(rowIds: string[]): void;
  onRowChange(rowId: string, update: { displayName: string }): void;
  onAssignVersion(rowIds: readonly string[], version: ImportVersionAssignment): void;
  onMoveRow(rowId: string, direction: -1 | 1): void;
  onRemoveRow(rowId: string): void;
}

export function ImageImportPreviewTable({
  rows,
  versions,
  pendingVersionNos,
  selectedIds,
  selectedCount,
  readyCount,
  allReadySelected,
  clock,
  busy,
  onToggleAll,
  onToggleRow,
  onCreateVersion,
  onRowChange,
  onAssignVersion,
  onMoveRow,
  onRemoveRow,
}: Props) {
  const l = useI18n().messages.creator.workbench;
  return (
    <Table>
      <TableHeader className="sticky top-0 z-10 bg-overlay">
        <TableRow>
          <TableHead className="w-10">
            <Checkbox
              aria-label={l.selectAllResults}
              checked={allReadySelected ? true : selectedCount > 0 ? 'indeterminate' : false}
              disabled={busy || !readyCount}
              onCheckedChange={(checked) => onToggleAll(checked === true)}
            />
          </TableHead>
          <TableHead className="w-16">{l.preview}</TableHead>
          <TableHead className="min-w-40">{l.resultName}</TableHead>
          <TableHead className="min-w-44">{l.linkedVersion}</TableHead>
          <TableHead className="w-24">{l.importState}</TableHead>
          <TableHead className="w-24 text-center">{l.order}</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => {
          const isExpired = row.state === 'READY' && row.expiresAt !== undefined && row.expiresAt <= clock;
          const isReady = row.state === 'READY' && !isExpired;
          const stateLabel = isExpired
            ? l.importExpired
            : isReady
              ? l.readyToImport
              : row.state === 'DUPLICATE'
                ? l.duplicates
                : l.invalid;
          return (
            <TableRow key={row.item.id} data-state={selectedIds.has(row.item.id) && isReady ? 'selected' : undefined}>
              <TableCell>
                <Checkbox
                  aria-label={l.selectResult(row.displayName)}
                  checked={selectedIds.has(row.item.id) && isReady}
                  disabled={busy || !isReady}
                  onCheckedChange={(checked) => onToggleRow(row.item.id, checked === true)}
                />
              </TableCell>
              <TableCell>
                <div className="grid size-12 place-items-center overflow-hidden bg-surface-sunken">
                  {row.previewUrl ? (
                    <img
                      src={row.previewUrl}
                      alt={row.displayName}
                      className="size-full bg-media-surround-light object-contain"
                    />
                  ) : (
                    <ImageIcon className="size-4 text-muted-foreground" />
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Input
                  className="h-8 text-xs"
                  value={row.displayName}
                  maxLength={500}
                  disabled={busy || !isReady}
                  aria-label={l.resultName}
                  aria-invalid={isReady && !row.displayName.trim()}
                  onChange={(event) => onRowChange(row.item.id, { displayName: event.target.value })}
                />
              </TableCell>
              <TableCell>
                <ImportVersionSelect
                  value={importVersionValue(row)}
                  versions={versions}
                  pendingVersionNos={pendingVersionNos}
                  disabled={busy || !isReady}
                  label={l.linkedVersion}
                  onChange={(version) => onAssignVersion([row.item.id], version)}
                  onCreate={() => onCreateVersion([row.item.id])}
                />
              </TableCell>
              <TableCell>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                  {isReady ? (
                    <CheckIcon className="size-3.5 text-success" />
                  ) : row.state === 'DUPLICATE' ? (
                    <CopyIcon className="size-3.5" />
                  ) : (
                    <XIcon className="size-3.5 text-destructive" />
                  )}
                  {stateLabel}
                </span>
              </TableCell>
              <TableCell>
                <div className="flex justify-center gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={busy || index === 0}
                    title={l.moveResultUp}
                    aria-label={l.moveResultUp}
                    onClick={() => onMoveRow(row.item.id, -1)}
                  >
                    <ArrowUpIcon className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={busy || index === rows.length - 1}
                    title={l.moveResultDown}
                    aria-label={l.moveResultDown}
                    onClick={() => onMoveRow(row.item.id, 1)}
                  >
                    <ArrowDownIcon className="size-4" />
                  </Button>
                </div>
              </TableCell>
              <TableCell>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={busy}
                  title={l.removeResult}
                  aria-label={l.removeResult}
                  onClick={() => onRemoveRow(row.item.id)}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
