import { useCallback, useState } from 'react';
import type { CreatorImageImportContext, CreatorOutputsImportResult } from '@/shared/contracts';
import {
  imageImportItems,
  type RendererImageImportItem,
  type RendererImageImportPreviewRow,
  type RendererImageImportSource,
} from '@/renderer/components/creator/imageImport';

const maxDraftImages = 8;

interface OutputImportMessages {
  importFailed: string;
  imported: string;
  duplicates: string;
  tooManyImages: string;
}

interface OutputImportOptions {
  createContext(source: RendererImageImportSource, sourceUrl?: string): CreatorImageImportContext;
  defaultPromptVersionId: string | null;
  applyImportedOutputs(result: Pick<CreatorOutputsImportResult, 'seriesId' | 'assetIds'>): void;
  refresh(): Promise<void>;
  notify(message: string): void;
  messages: OutputImportMessages;
}

interface OutputImportPreview {
  context: CreatorImageImportContext;
  defaultVersionId: string | null;
  rows: RendererImageImportPreviewRow[] | null;
}

function releasePreviewUrls(rows: readonly RendererImageImportPreviewRow[] | null) {
  for (const row of rows ?? []) {
    if (row.previewUrl) URL.revokeObjectURL(row.previewUrl);
  }
}

export function useCreatorOutputImport({
  createContext,
  defaultPromptVersionId,
  applyImportedOutputs,
  refresh,
  notify,
  messages,
}: OutputImportOptions) {
  const [staging, setStaging] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<OutputImportPreview | null>(null);
  const busy = staging || committing;

  const appendRows = useCallback(
    (
      context: CreatorImageImportContext,
      rows: Awaited<ReturnType<typeof window.desktopApi.creatorOutputsStage>>,
      previewUrls: ReadonlyMap<string, string> = new Map(),
    ) => {
      setPreview((current) => {
        const inheritedVersionId = current ? current.defaultVersionId : defaultPromptVersionId;
        const nextRows = rows.map((row) => ({
          ...row,
          displayName: row.item.name,
          promptVersionId: inheritedVersionId,
          previewUrl: previewUrls.get(row.item.id) ?? null,
        }));
        return {
          context: current?.context ?? context,
          defaultVersionId: inheritedVersionId,
          rows: [...(current?.rows ?? []), ...nextRows],
        };
      });
    },
    [defaultPromptVersionId],
  );

  const previewItems = useCallback(
    async (
      items: RendererImageImportItem[],
      source: RendererImageImportSource,
      sourceUrl = '',
      previewUrls: ReadonlyMap<string, string> = new Map(),
    ) => {
      if (busy) {
        for (const url of previewUrls.values()) URL.revokeObjectURL(url);
        return;
      }
      const currentCount = preview?.rows?.length ?? 0;
      if (currentCount + items.length > maxDraftImages) {
        for (const url of previewUrls.values()) URL.revokeObjectURL(url);
        notify(messages.tooManyImages);
        return;
      }
      const context = preview?.context ?? createContext(source, sourceUrl);
      if (!preview) {
        setPreview({ context, defaultVersionId: defaultPromptVersionId, rows: null });
      }
      setStaging(true);
      try {
        const rows = await window.desktopApi.creatorOutputsStage(items);
        appendRows(context, rows, previewUrls);
      } catch (reason) {
        for (const url of previewUrls.values()) URL.revokeObjectURL(url);
        if (!preview) setPreview(null);
        notify(`${messages.importFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
      } finally {
        setStaging(false);
      }
    },
    [appendRows, busy, createContext, defaultPromptVersionId, messages, notify, preview],
  );

  const previewFiles = useCallback(
    async (files: File[], source: RendererImageImportSource, sourceUrl = '') => {
      if (busy) return;
      try {
        const items = await imageImportItems(files);
        if (!items.length) return;
        const previewUrls = new Map(items.map((item, index) => [item.id, URL.createObjectURL(files[index])] as const));
        await previewItems(items, source, sourceUrl, previewUrls);
      } catch (reason) {
        notify(`${messages.importFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    },
    [busy, messages.importFailed, notify, previewItems],
  );

  const chooseFiles = useCallback(async () => {
    if (busy) return;
    setStaging(true);
    try {
      const context = preview?.context ?? createContext('UPLOAD');
      const rows = await window.desktopApi.creatorOutputsChoose({ context });
      if (!rows) return;
      if ((preview?.rows?.length ?? 0) + rows.length > maxDraftImages) {
        const stageIds = rows.flatMap((row) => row.item.stageId ?? []);
        if (stageIds.length) await window.desktopApi.creatorOutputsDiscard(stageIds);
        notify(messages.tooManyImages);
        return;
      }
      appendRows(context, rows);
    } catch (reason) {
      notify(`${messages.importFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setStaging(false);
    }
  }, [appendRows, busy, createContext, messages, notify, preview]);

  const commit = useCallback(async () => {
    if (!preview?.rows || busy) return;
    const readyRows = preview.rows.filter((row) => row.state === 'READY' && row.item.stageId);
    if (!readyRows.length || readyRows.some((row) => !row.displayName.trim())) return;
    const duplicateCount = preview.rows.filter((row) => row.state === 'DUPLICATE').length;
    setCommitting(true);
    let result: CreatorOutputsImportResult;
    try {
      result = await window.desktopApi.creatorOutputsImport({
        context: preview.context,
        items: readyRows.map((row) => ({
          stageId: row.item.stageId!,
          promptVersionId: row.promptVersionId,
          displayName: row.displayName.trim(),
        })),
      });
    } catch (reason) {
      notify(`${messages.importFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
      setCommitting(false);
      return;
    }

    applyImportedOutputs(result);
    releasePreviewUrls(preview.rows);
    setPreview(null);
    try {
      await refresh();
    } catch (reason) {
      notify(`${messages.importFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
    const duplicates = duplicateCount + result.duplicateCount;
    notify(
      `${messages.imported} · ${result.assetIds.length}${duplicates ? ` · ${messages.duplicates} ${duplicates}` : ''}`,
    );
    setCommitting(false);
  }, [applyImportedOutputs, busy, messages, notify, preview, refresh]);

  const dismiss = useCallback(() => {
    if (busy) return;
    const rows = preview?.rows ?? null;
    const stageIds = rows?.flatMap((row) => row.item.stageId ?? []) ?? [];
    releasePreviewUrls(rows);
    setPreview(null);
    if (stageIds.length) {
      void window.desktopApi.creatorOutputsDiscard(stageIds).catch((reason) => {
        notify(reason instanceof Error ? reason.message : String(reason));
      });
    }
  }, [busy, notify, preview]);

  const setDefaultVersionId = useCallback((promptVersionId: string | null) => {
    setPreview((current) => (current ? { ...current, defaultVersionId: promptVersionId } : current));
  }, []);

  const updateRow = useCallback(
    (rowId: string, update: Partial<Pick<RendererImageImportPreviewRow, 'displayName' | 'promptVersionId'>>) => {
      setPreview((current) =>
        current?.rows
          ? { ...current, rows: current.rows.map((row) => (row.item.id === rowId ? { ...row, ...update } : row)) }
          : current,
      );
    },
    [],
  );

  const assignVersion = useCallback((rowIds: readonly string[], promptVersionId: string | null) => {
    const selected = new Set(rowIds);
    setPreview((current) =>
      current?.rows
        ? {
            ...current,
            rows: current.rows.map((row) =>
              selected.has(row.item.id) && row.state === 'READY' ? { ...row, promptVersionId } : row,
            ),
          }
        : current,
    );
  }, []);

  const moveRow = useCallback((rowId: string, direction: -1 | 1) => {
    setPreview((current) => {
      if (!current?.rows) return current;
      const index = current.rows.findIndex((row) => row.item.id === rowId);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.rows.length) return current;
      const rows = [...current.rows];
      [rows[index], rows[destination]] = [rows[destination], rows[index]];
      return { ...current, rows };
    });
  }, []);

  const removeRow = useCallback(
    (rowId: string) => {
      if (busy) return;
      const row = preview?.rows?.find((candidate) => candidate.item.id === rowId);
      if (!row) return;
      if (row.previewUrl) URL.revokeObjectURL(row.previewUrl);
      setPreview((current) =>
        current?.rows ? { ...current, rows: current.rows.filter((candidate) => candidate.item.id !== rowId) } : current,
      );
      if (row.item.stageId) {
        void window.desktopApi.creatorOutputsDiscard([row.item.stageId]).catch((reason) => {
          notify(reason instanceof Error ? reason.message : String(reason));
        });
      }
    },
    [busy, notify, preview],
  );

  return {
    busy,
    staging,
    preview,
    previewFiles,
    chooseFiles,
    commit,
    dismiss,
    setDefaultVersionId,
    updateRow,
    assignVersion,
    moveRow,
    removeRow,
  };
}
