import { ImageImportPreviewTable } from '@/renderer/components/creator/ImageImportPreviewTable';
import { ImageIcon, LoaderCircleIcon, PlusIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PromptVersionDto } from '@/shared/contracts';
import type { ImportVersionAssignment, RendererImageImportPreviewRow } from '@/renderer/components/creator/imageImport';
import {
  ImportVersionSelect,
  importVersionValue,
  NewImportVersionDialog,
} from '@/renderer/components/creator/ImportVersionSelect';
import { PasteDropSurface } from '@/renderer/components/creator/intake/PasteDropSurface';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  open: boolean;
  rows: RendererImageImportPreviewRow[] | null;
  versions: readonly PromptVersionDto[];
  busy: boolean;
  staging: boolean;
  onOpenChange(open: boolean): void;
  onAddFiles(): void;
  onAddImages(files: File[], source: 'PASTE' | 'DROP', sourceUrl: string): void;
  onRowChange(
    rowId: string,
    update: Partial<Pick<RendererImageImportPreviewRow, 'displayName' | 'promptVersionId' | 'newVersionNo'>>,
  ): void;
  onAssignVersion(rowIds: readonly string[], version: ImportVersionAssignment): void;
  onMoveRow(rowId: string, direction: -1 | 1): void;
  onRemoveRow(rowId: string): void;
  onConfirm(rowIds: readonly string[]): void;
}

export function ImageImportPreviewDialog({
  open,
  rows,
  versions,
  busy,
  staging,
  onOpenChange,
  onAddFiles,
  onAddImages,
  onRowChange,
  onAssignVersion,
  onMoveRow,
  onRemoveRow,
  onConfirm,
}: Props) {
  const l = useI18n().messages.creator.workbench;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [newVersionTarget, setNewVersionTarget] = useState<{ rowIds: string[]; versionNo: number } | null>(null);
  const [clock, setClock] = useState(Date.now);
  const knownReadyIds = useRef(new Set<string>());
  const expired = (row: RendererImageImportPreviewRow) => row.expiresAt !== undefined && row.expiresAt <= clock;
  const readyRows = rows?.filter((row) => row.state === 'READY' && !expired(row)) ?? [];
  const selectedRows = readyRows.filter((row) => selectedIds.has(row.item.id));
  const allReadySelected = readyRows.length > 0 && readyRows.every((row) => selectedIds.has(row.item.id));
  const hasBlankName = selectedRows.some((row) => !row.displayName.trim());
  const pendingVersionNos = [...new Set(rows?.flatMap((row) => row.newVersionNo ?? []) ?? [])].sort((a, b) => b - a);
  const selectedValues = new Set(selectedRows.map(importVersionValue));
  const batchValue = selectedValues.size === 1 ? importVersionValue(selectedRows[0]) : '';
  const totalBytes = rows?.reduce((sum, row) => sum + row.item.byteSize, 0) ?? 0;

  useEffect(() => {
    if (!open) return;
    const nextExpiry = Math.min(
      ...(rows ?? []).flatMap((row) => (row.expiresAt && row.expiresAt > clock ? [row.expiresAt] : [])),
    );
    if (!Number.isFinite(nextExpiry)) return;
    const timeout = setTimeout(() => setClock(Date.now()), Math.max(1, nextExpiry - Date.now() + 1));
    return () => clearTimeout(timeout);
  }, [open, rows, clock]);

  useEffect(() => {
    if (!open) {
      knownReadyIds.current = new Set();
      setSelectedIds(new Set());
      return;
    }
    const readyIds = new Set(
      (rows ?? [])
        .filter((row) => row.state === 'READY' && (row.expiresAt === undefined || row.expiresAt > clock))
        .map((row) => row.item.id),
    );
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => readyIds.has(id)));
      for (const id of readyIds) if (!knownReadyIds.current.has(id)) next.add(id);
      return next;
    });
    knownReadyIds.current = readyIds;
  }, [open, rows, clock]);

  function toggleRow(rowId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }

  function requestVersion(rowIds: string[]) {
    const nextVersionNo = Math.max(0, ...versions.map((version) => version.versionNo), ...pendingVersionNos) + 1;
    const name = rowIds.length === 1 ? rows?.find((row) => row.item.id === rowIds[0])?.displayName : '';
    const match = name?.match(/(?:^|[\s._-])v(\d{1,6})(?=$|[\s._-])/i);
    const suggestion = match ? Number(match[1]) : nextVersionNo;
    setNewVersionTarget({ rowIds, versionNo: Math.min(999999, Math.max(1, suggestion)) });
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy && !newVersionTarget) onOpenChange(next);
        }}
      >
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[calc(100vh-2rem)] max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto]"
        >
          <DialogHeader>
            <DialogTitle>{l.reviewImport}</DialogTitle>
          </DialogHeader>
          <PasteDropSurface
            className="min-h-0 overflow-hidden"
            disabled={busy}
            respectEditableImagePaste
            overlay={<span className="text-sm font-medium">{l.releaseToAddResults}</span>}
            onImages={onAddImages}
          >
            <div className="flex flex-wrap items-center gap-3 border-b py-3">
              <span className="text-xs text-muted-foreground">{l.selectedResults(selectedRows.length)}</span>
              {selectedRows.length > 0 && (
                <div className="w-56">
                  <ImportVersionSelect
                    value={batchValue}
                    versions={versions}
                    pendingVersionNos={pendingVersionNos}
                    disabled={busy}
                    label={l.selectedVersion}
                    onChange={(version) =>
                      onAssignVersion(
                        selectedRows.map((row) => row.item.id),
                        version,
                      )
                    }
                    onCreate={() => requestVersion(selectedRows.map((row) => row.item.id))}
                  />
                </div>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={busy || (rows?.length ?? 0) >= 8}
                onClick={onAddFiles}
              >
                {staging ? <LoaderCircleIcon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
                {l.addImages}
              </Button>
            </div>
            <div className="max-h-[min(28rem,calc(100vh-16rem))] min-h-40 overflow-auto">
              {!rows && (
                <div className="grid h-40 place-items-center">
                  <LoaderCircleIcon className="size-5 animate-spin" />
                </div>
              )}
              {rows?.length === 0 && (
                <div className="grid h-40 place-items-center">
                  <ImageIcon className="size-6 text-muted-foreground" />
                </div>
              )}
              {rows && rows.length > 0 && (
                <ImageImportPreviewTable
                  rows={rows}
                  versions={versions}
                  pendingVersionNos={pendingVersionNos}
                  selectedIds={selectedIds}
                  selectedCount={selectedRows.length}
                  readyCount={readyRows.length}
                  allReadySelected={allReadySelected}
                  clock={clock}
                  busy={busy}
                  onToggleAll={(checked) =>
                    setSelectedIds(checked ? new Set(readyRows.map((row) => row.item.id)) : new Set())
                  }
                  onToggleRow={toggleRow}
                  onCreateVersion={requestVersion}
                  onRowChange={onRowChange}
                  onAssignVersion={onAssignVersion}
                  onMoveRow={onMoveRow}
                  onRemoveRow={onRemoveRow}
                />
              )}
            </div>
          </PasteDropSurface>
          <DialogFooter className="items-center">
            <span className="mr-auto text-xs text-muted-foreground">
              {l.importCapacity(rows?.length ?? 0, (totalBytes / 1024 / 1024).toFixed(1))}
            </span>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              {l.cancel}
            </Button>
            <Button
              type="button"
              disabled={busy || !selectedRows.length || hasBlankName}
              onClick={() => onConfirm(selectedRows.map((row) => row.item.id))}
            >
              {busy && !staging ? l.importing : l.importSelectedResults} · {selectedRows.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {newVersionTarget && (
        <NewImportVersionDialog
          initialVersionNo={newVersionTarget.versionNo}
          versions={versions}
          onAssign={(version) => onAssignVersion(newVersionTarget.rowIds, version)}
          onClose={() => setNewVersionTarget(null)}
        />
      )}
    </>
  );
}
