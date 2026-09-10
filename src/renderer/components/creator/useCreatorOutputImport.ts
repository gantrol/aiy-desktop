import { useEffect, useRef, useState } from 'react';
import type { CreatorImageImportContext, CreatorOutputsImportResult } from '@/shared/contracts';
import {
  imageImportItems,
  type ImportVersionAssignment,
  type RendererImageImportPreviewRow,
  type RendererImageImportSource,
} from '@/renderer/components/creator/imageImport';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
import { useI18n } from '@/renderer/i18n/useI18n';

const maxDraftImages = 8;
const maxBatchBytes = 100 * 1024 * 1024;

interface OutputImportMessages {
  importFailed: string;
  imported: string;
  duplicates: string;
  tooManyImages: string;
}

interface OutputImportOptions {
  createContext(source: RendererImageImportSource, sourceUrl?: string): CreatorImageImportContext;
  prepareContext?(context: CreatorImageImportContext): Promise<{
    context: CreatorImageImportContext;
  }>;
  defaultPromptVersionId: string | null;
  applyImportedOutputs(result: Pick<CreatorOutputsImportResult, 'seriesId' | 'assetIds'>): void;
  refresh(): Promise<void>;
  notify(message: string, options?: { copyText: string }): void;
  messages: OutputImportMessages;
}

interface OutputImportPreview {
  context: CreatorImageImportContext;
  rows: RendererImageImportPreviewRow[] | null;
}

function releasePreviewUrls(rows: readonly RendererImageImportPreviewRow[] | null) {
  for (const row of rows ?? []) {
    if (row.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(row.previewUrl);
  }
}

async function discardRows(rows: readonly RendererImageImportPreviewRow[]) {
  releasePreviewUrls(rows);
  const ids = rows.flatMap((row) => row.item.stageId ?? []);
  if (ids.length) await window.desktopApi.creatorOutputsDiscard(ids);
}

function useImportPreviewState() {
  const [preview, setPreviewState] = useState<OutputImportPreview | null>(null);
  const previewRef = useRef(preview);
  const mountedRef = useRef(true);

  const setPreview = useStableCallback((value: OutputImportPreview | null) => {
    previewRef.current = value;
    if (mountedRef.current) setPreviewState(value);
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const current = previewRef.current;
      previewRef.current = null;
      if (current?.rows) void discardRows(current.rows).catch(() => undefined);
    };
  }, []);

  return { preview, previewRef, mountedRef, setPreview };
}

export function useCreatorOutputImport(options: OutputImportOptions) {
  const labels = useI18n().messages.creator.workbench;
  const { createContext, prepareContext, defaultPromptVersionId, applyImportedOutputs, refresh, notify, messages } =
    options;
  const [staging, setStaging] = useState(false);
  const [committing, setCommitting] = useState(false);
  const { preview, previewRef, mountedRef, setPreview } = useImportPreviewState();
  const busyRef = useRef(false);
  const busy = staging || committing;
  const notifyImportError = useStableCallback((reason: unknown) => {
    const message = `${messages.importFailed}: ${reason instanceof Error ? reason.message : String(reason)}`;
    if (mountedRef.current) notify(message, { copyText: message });
  });

  const appendRows = useStableCallback(
    async (
      context: CreatorImageImportContext,
      rows: Awaited<ReturnType<typeof window.desktopApi.creatorOutputsStage>>,
      source: RendererImageImportSource,
      sourceUrl: string,
      previewUrls: ReadonlyMap<string, string> = new Map(),
    ) => {
      const nextRows: RendererImageImportPreviewRow[] = rows.map((row) => ({
        ...row,
        displayName: row.item.name,
        promptVersionId: context.versionId,
        source,
        sourceUrl,
        previewUrl: previewUrls.get(row.item.id) ?? row.previewUrl ?? null,
      }));
      if (!mountedRef.current) {
        await discardRows(nextRows);
        return;
      }
      const currentRows = previewRef.current?.rows ?? [];
      if (currentRows.length + nextRows.length > maxDraftImages) {
        await discardRows(nextRows);
        notify(messages.tooManyImages);
        return;
      }
      const totalBytes = [...currentRows, ...nextRows].reduce((sum, row) => sum + row.item.byteSize, 0);
      if (totalBytes > maxBatchBytes) {
        await discardRows(nextRows);
        notify(labels.importBatchTooLarge);
        return;
      }
      setPreview({ context: previewRef.current?.context ?? context, rows: [...currentRows, ...nextRows] });
    },
  );

  const previewFiles = useStableCallback(
    async (files: File[], source: RendererImageImportSource, sourceUrl: string = '') => {
      if (busyRef.current || !files.length) return;
      const currentRows = previewRef.current?.rows ?? [];
      if (currentRows.length + files.length > maxDraftImages) {
        notify(messages.tooManyImages);
        return;
      }
      const totalBytes =
        currentRows.reduce((sum, row) => sum + row.item.byteSize, 0) + files.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > maxBatchBytes) {
        notify(labels.importBatchTooLarge);
        return;
      }
      busyRef.current = true;
      setStaging(true);
      const context = previewRef.current?.context ?? {
        ...createContext(source, sourceUrl),
        versionId: defaultPromptVersionId,
      };
      const previewUrls = new Map<string, string>();
      if (!previewRef.current) setPreview({ context, rows: null });
      try {
        const items = await imageImportItems(files);
        if (!mountedRef.current) return;
        for (const [index, item] of items.entries()) previewUrls.set(item.id, URL.createObjectURL(files[index]));
        const rows = await window.desktopApi.creatorOutputsStage(items, context.seriesId);
        await appendRows(context, rows, source, sourceUrl, previewUrls);
      } catch (reason) {
        for (const url of previewUrls.values()) URL.revokeObjectURL(url);
        if (!previewRef.current?.rows) setPreview(null);
        notifyImportError(reason);
      } finally {
        busyRef.current = false;
        if (mountedRef.current) setStaging(false);
      }
    },
  );

  const chooseFiles = useStableCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setStaging(true);
    try {
      const context = previewRef.current?.context ?? { ...createContext('UPLOAD'), versionId: defaultPromptVersionId };
      const rows = await window.desktopApi.creatorOutputsChoose({ context });
      if (rows) await appendRows(context, rows, 'UPLOAD', '');
    } catch (reason) {
      notifyImportError(reason);
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setStaging(false);
    }
  });

  const commit = useStableCallback(async (selectedRowIds: readonly string[]) => {
    const current = previewRef.current;
    if (!current?.rows || busyRef.current) return;
    const selected = new Set(selectedRowIds);
    const readyRows = current.rows.filter(
      (row) => selected.has(row.item.id) && row.state === 'READY' && row.item.stageId,
    );
    if (!readyRows.length || readyRows.some((row) => !row.displayName.trim())) return;
    if (readyRows.some((row) => row.expiresAt !== undefined && row.expiresAt <= Date.now())) {
      notify(labels.importExpiredRetry);
      return;
    }
    busyRef.current = true;
    setCommitting(true);
    try {
      const prepared = prepareContext ? await prepareContext(current.context) : { context: current.context };
      if (!mountedRef.current) return;
      // A row's explicit choice, including null, survives creation preparation unchanged.
      const preparedRows = current.rows;
      setPreview({ context: prepared.context, rows: preparedRows });
      let result: CreatorOutputsImportResult;
      try {
        result = await window.desktopApi.creatorOutputsImport({
          context: prepared.context,
          items: preparedRows
            .filter((row) => selected.has(row.item.id) && row.state === 'READY' && row.item.stageId)
            .map((row) => ({
              stageId: row.item.stageId!,
              promptVersionId: row.promptVersionId,
              newVersionNo: row.newVersionNo,
              displayName: row.displayName.trim(),
              source: row.source,
              sourceUrl: row.sourceUrl,
            })),
        });
      } catch (reason) {
        notifyImportError(reason);
        return;
      }
      setPreview(null);
      releasePreviewUrls(current.rows);
      const remaining = current.rows.filter((row) => !selected.has(row.item.id));
      try {
        await discardRows(remaining);
      } catch (reason) {
        if (mountedRef.current) notify(String(reason));
      }
      if (!mountedRef.current) return;
      const duplicates = current.rows.filter((row) => row.state === 'DUPLICATE').length + result.duplicateCount;
      notify(
        `${messages.imported} · ${result.assetIds.length}${duplicates ? ` · ${messages.duplicates} ${duplicates}` : ''}`,
      );
      try {
        applyImportedOutputs(result);
        await refresh();
      } catch (reason) {
        notify(`${labels.importRefreshFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    } catch (reason) {
      notifyImportError(reason);
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setCommitting(false);
    }
  });

  const dismiss = useStableCallback(() => {
    if (busyRef.current) return;
    const rows = previewRef.current?.rows ?? [];
    setPreview(null);
    void discardRows(rows).catch((reason) => notify(String(reason)));
  });

  const updateRow = useStableCallback(
    (
      rowId: string,
      update: Partial<Pick<RendererImageImportPreviewRow, 'displayName' | 'promptVersionId' | 'newVersionNo'>>,
    ) => {
      const current = previewRef.current;
      if (!current?.rows || busyRef.current) return;
      const explicitVersion = 'promptVersionId' in update || 'newVersionNo' in update;
      setPreview({
        ...current,
        rows: current.rows.map((row) =>
          row.item.id === rowId
            ? {
                ...row,
                ...(explicitVersion ? { newVersionNo: undefined } : {}),
                ...update,
              }
            : row,
        ),
      });
    },
  );

  const assignVersion = useStableCallback((rowIds: readonly string[], version: ImportVersionAssignment) => {
    const current = previewRef.current;
    if (!current?.rows || busyRef.current) return;
    const selected = new Set(rowIds);
    setPreview({
      ...current,
      rows: current.rows.map((row) =>
        selected.has(row.item.id) && row.state === 'READY' ? { ...row, newVersionNo: undefined, ...version } : row,
      ),
    });
  });

  const moveRow = useStableCallback((rowId: string, direction: -1 | 1) => {
    const current = previewRef.current;
    if (!current?.rows || busyRef.current) return;
    const rows = [...current.rows];
    const index = rows.findIndex((row) => row.item.id === rowId);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= rows.length) return;
    [rows[index], rows[destination]] = [rows[destination], rows[index]];
    setPreview({ ...current, rows });
  });

  const removeRow = useStableCallback((rowId: string) => {
    const current = previewRef.current;
    if (!current?.rows || busyRef.current) return;
    const row = current.rows.find((candidate) => candidate.item.id === rowId);
    if (!row) return;
    setPreview({ ...current, rows: current.rows.filter((candidate) => candidate !== row) });
    void discardRows([row]).catch((reason) => notify(String(reason)));
  });

  return {
    busy,
    staging,
    preview,
    previewFiles,
    chooseFiles,
    commit,
    dismiss,
    updateRow,
    assignVersion,
    moveRow,
    removeRow,
  };
}
