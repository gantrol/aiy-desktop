import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  ImageIcon,
  LoaderCircleIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PromptVersionDto } from '@/shared/contracts';
import type { RendererImageImportPreviewRow } from '@/renderer/components/creator/imageImport';
import { PasteDropSurface } from '@/renderer/components/creator/intake/PasteDropSurface';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/renderer/components/ui/table';
import { useI18n } from '@/renderer/i18n/useI18n';

const unlinkedVersionValue = '__unlinked__';

function versionValue(versionId: string | null) {
  return versionId ?? unlinkedVersionValue;
}

function parsedVersionValue(value: string) {
  return value === unlinkedVersionValue ? null : value;
}

function versionLabel(version: PromptVersionDto) {
  const base = `V${String(version.versionNo).padStart(2, '0')}`;
  return version.changeSummary ? `${base} · ${version.changeSummary}` : base;
}

interface ImportVersionSelectProps {
  value: string | null;
  versions: readonly PromptVersionDto[];
  disabled: boolean;
  label: string;
  unlinkedLabel: string;
  onChange(versionId: string | null): void;
}

function ImportVersionSelect({ value, versions, disabled, label, unlinkedLabel, onChange }: ImportVersionSelectProps) {
  return (
    <Select
      value={versionValue(value)}
      disabled={disabled}
      onValueChange={(next) => onChange(parsedVersionValue(next))}
    >
      <SelectTrigger className="h-8 min-w-32 text-xs" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={unlinkedVersionValue}>{unlinkedLabel}</SelectItem>
        {versions.map((version) => (
          <SelectItem key={version.id} value={version.id}>
            {versionLabel(version)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ImportState({
  state,
  readyLabel,
  duplicateLabel,
  invalidLabel,
}: {
  state: RendererImageImportPreviewRow['state'];
  readyLabel: string;
  duplicateLabel: string;
  invalidLabel: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {state === 'READY' ? (
        <CheckIcon className="size-3.5 text-success" />
      ) : state === 'DUPLICATE' ? (
        <CopyIcon className="size-3.5" />
      ) : (
        <XIcon className="size-3.5 text-destructive" />
      )}
      {state === 'READY' ? readyLabel : state === 'DUPLICATE' ? duplicateLabel : invalidLabel}
    </span>
  );
}

function ImportTableHeader({
  labels,
  checked,
  disabled,
  onToggle,
}: {
  labels: ReturnType<typeof useI18n>['messages']['creator']['workbench'];
  checked: boolean | 'indeterminate';
  disabled: boolean;
  onToggle(checked: boolean): void;
}) {
  return (
    <TableHeader className="sticky top-0 z-10 bg-overlay">
      <TableRow>
        <TableHead className="w-10">
          <Checkbox
            aria-label={labels.selectAllResults}
            checked={checked}
            disabled={disabled}
            onCheckedChange={(next) => onToggle(next === true)}
          />
        </TableHead>
        <TableHead className="w-16">{labels.preview}</TableHead>
        <TableHead className="min-w-52">{labels.resultName}</TableHead>
        <TableHead className="min-w-44">{labels.linkedVersion}</TableHead>
        <TableHead className="w-24">{labels.importState}</TableHead>
        <TableHead className="w-28 text-center">{labels.order}</TableHead>
        <TableHead className="w-12" />
      </TableRow>
    </TableHeader>
  );
}

interface Props {
  open: boolean;
  rows: RendererImageImportPreviewRow[] | null;
  versions: readonly PromptVersionDto[];
  defaultVersionId: string | null;
  busy: boolean;
  staging: boolean;
  onOpenChange(open: boolean): void;
  onAddFiles(): void;
  onAddImages(files: File[], source: 'PASTE' | 'DROP', sourceUrl: string): void;
  onDefaultVersionChange(versionId: string | null): void;
  onRowChange(
    rowId: string,
    update: Partial<Pick<RendererImageImportPreviewRow, 'displayName' | 'promptVersionId'>>,
  ): void;
  onAssignVersion(rowIds: readonly string[], versionId: string | null): void;
  onMoveRow(rowId: string, direction: -1 | 1): void;
  onRemoveRow(rowId: string): void;
  onConfirm(): void;
}

export function ImageImportPreviewDialog({
  open,
  rows,
  versions,
  defaultVersionId,
  busy,
  staging,
  onOpenChange,
  onAddFiles,
  onAddImages,
  onDefaultVersionChange,
  onRowChange,
  onAssignVersion,
  onMoveRow,
  onRemoveRow,
  onConfirm,
}: Props) {
  const l = useI18n().messages.creator.workbench;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchVersionId, setBatchVersionId] = useState<string | null>(defaultVersionId);
  const knownReadyIds = useRef(new Set<string>());
  const readyRows = rows?.filter((row) => row.state === 'READY') ?? [];
  const ready = readyRows.length;
  const allReadySelected = ready > 0 && readyRows.every((row) => selectedIds.has(row.item.id));
  const someReadySelected = readyRows.some((row) => selectedIds.has(row.item.id));
  const hasBlankName = readyRows.some((row) => !row.displayName.trim());

  useEffect(() => {
    if (!open) {
      knownReadyIds.current = new Set();
      setSelectedIds(new Set());
      return;
    }
    const currentReadyIds = new Set((rows ?? []).filter((row) => row.state === 'READY').map((row) => row.item.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((rowId) => currentReadyIds.has(rowId)));
      for (const rowId of currentReadyIds) {
        if (!knownReadyIds.current.has(rowId)) next.add(rowId);
      }
      return next;
    });
    knownReadyIds.current = currentReadyIds;
  }, [open, rows]);

  useEffect(() => {
    if (open) setBatchVersionId(defaultVersionId);
  }, [defaultVersionId, open]);

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(readyRows.map((row) => row.item.id)) : new Set());
  }

  function toggleRow(rowId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>{l.reviewImport}</DialogTitle>
          <DialogDescription>{l.importDraftDescription}</DialogDescription>
        </DialogHeader>

        <PasteDropSurface
          className="min-h-0 overflow-hidden rounded-lg border"
          disabled={busy}
          respectEditableImagePaste
          overlay={<span className="text-sm font-medium">{l.releaseToAddResults}</span>}
          onImages={onAddImages}
        >
          <div className="flex flex-wrap items-end gap-3 border-b bg-surface-sunken/60 p-3">
            <div className="grid min-w-44 gap-1">
              <span className="text-xs font-medium text-foreground-secondary">{l.newImagesDefaultVersion}</span>
              <ImportVersionSelect
                value={defaultVersionId}
                versions={versions}
                disabled={busy}
                label={l.newImagesDefaultVersion}
                unlinkedLabel={l.unlinkedVersion}
                onChange={onDefaultVersionChange}
              />
            </div>
            <div className="grid min-w-44 gap-1">
              <span className="text-xs font-medium text-foreground-secondary">{l.selectedVersion}</span>
              <ImportVersionSelect
                value={batchVersionId}
                versions={versions}
                disabled={busy}
                label={l.selectedVersion}
                unlinkedLabel={l.unlinkedVersion}
                onChange={setBatchVersionId}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !someReadySelected}
              onClick={() => onAssignVersion([...selectedIds], batchVersionId)}
            >
              {l.applyToSelected}
            </Button>
            <span className="mr-auto pb-1 text-xs text-muted-foreground">{l.selectedResults(selectedIds.size)}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || (rows?.length ?? 0) >= 8}
              onClick={onAddFiles}
            >
              {staging ? <LoaderCircleIcon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
              {l.addImages}
            </Button>
          </div>

          <div className="max-h-[min(28rem,calc(100vh-19rem))] min-h-40 overflow-auto">
            {!rows && (
              <div className="grid h-40 place-items-center">
                <LoaderCircleIcon className="size-5 animate-spin" />
              </div>
            )}
            {rows?.length === 0 && (
              <div className="grid h-40 place-items-center text-sm text-muted-foreground">{l.pasteOrDropResults}</div>
            )}
            {rows && rows.length > 0 && (
              <Table>
                <ImportTableHeader
                  labels={l}
                  checked={allReadySelected ? true : someReadySelected ? 'indeterminate' : false}
                  disabled={busy || !ready}
                  onToggle={toggleAll}
                />
                <TableBody>
                  {rows.map((row, index) => {
                    const isReady = row.state === 'READY';
                    return (
                      <TableRow key={row.item.id} data-state={selectedIds.has(row.item.id) ? 'selected' : undefined}>
                        <TableCell>
                          <Checkbox
                            aria-label={l.selectResult(row.displayName)}
                            checked={selectedIds.has(row.item.id)}
                            disabled={busy || !isReady}
                            onCheckedChange={(checked) => toggleRow(row.item.id, checked === true)}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="grid size-10 place-items-center overflow-hidden rounded border bg-surface-sunken">
                            {row.previewUrl ? (
                              <img src={row.previewUrl} alt="" className="size-full object-cover" />
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
                            onChange={(event) => onRowChange(row.item.id, { displayName: event.target.value })}
                          />
                        </TableCell>
                        <TableCell>
                          <ImportVersionSelect
                            value={row.promptVersionId}
                            versions={versions}
                            disabled={busy || !isReady}
                            label={l.linkedVersion}
                            unlinkedLabel={l.unlinkedVersion}
                            onChange={(promptVersionId) => onRowChange(row.item.id, { promptVersionId })}
                          />
                        </TableCell>
                        <TableCell>
                          <ImportState
                            state={row.state}
                            readyLabel={l.readyToImport}
                            duplicateLabel={l.duplicates}
                            invalidLabel={l.invalid}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-1">
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
            )}
          </div>
        </PasteDropSurface>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {l.cancel}
          </Button>
          <Button type="button" disabled={busy || !ready || hasBlankName} onClick={onConfirm}>
            {busy && !staging ? l.importing : l.importResults} · {ready}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
