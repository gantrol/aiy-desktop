import { useCallback, useState } from 'react';
import type { CreatorImageImportContext, CreatorOutputsImportResult } from '@/shared/contracts';
import {
  imageImportItems,
  type RendererImageImportItem,
  type RendererImageImportPreviewRow,
  type RendererImageImportSource,
} from '@/renderer/components/creator/imageImport';

interface OutputImportMessages {
  importFailed: string;
  imported: string;
  duplicates: string;
}

interface OutputImportOptions {
  createContext(source: RendererImageImportSource, sourceUrl?: string): CreatorImageImportContext;
  applyImportedOutputs(result: Pick<CreatorOutputsImportResult, 'seriesId' | 'assetIds'>): void;
  refresh(): Promise<void>;
  notify(message: string): void;
  messages: OutputImportMessages;
}

export function useCreatorOutputImport({
  createContext,
  applyImportedOutputs,
  refresh,
  notify,
  messages,
}: OutputImportOptions) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    context: CreatorImageImportContext;
    rows: RendererImageImportPreviewRow[] | null;
  } | null>(null);

  const previewItems = useCallback(
    async (items: RendererImageImportItem[], source: RendererImageImportSource, sourceUrl = '') => {
      const context = createContext(source, sourceUrl);
      setPreview({ context, rows: null });
      try {
        const rows = await window.desktopApi.creatorOutputsStage(items);
        setPreview({ context, rows });
      } catch (reason) {
        setPreview(null);
        notify(`${messages.importFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    },
    [createContext, messages.importFailed, notify],
  );

  const previewFiles = useCallback(
    async (files: File[], source: RendererImageImportSource, sourceUrl = '') => {
      if (busy) return;
      try {
        const items = await imageImportItems(files);
        if (items.length) await previewItems(items, source, sourceUrl);
      } catch (reason) {
        notify(`${messages.importFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    },
    [busy, messages.importFailed, notify, previewItems],
  );

  const commit = useCallback(async () => {
    if (!preview?.rows || busy) return;
    const stageIds = preview.rows.filter((row) => row.state === 'READY').flatMap((row) => row.item.stageId ?? []);
    if (!stageIds.length) return;
    const previewDuplicates = preview.rows.filter((row) => row.state === 'DUPLICATE').length;
    setBusy(true);
    try {
      const result = await window.desktopApi.creatorOutputsImport({ context: preview.context, stageIds });
      applyImportedOutputs(result);
      await refresh();
      setPreview(null);
      const duplicates = previewDuplicates + result.duplicateCount;
      notify(
        `${messages.imported} · ${result.assetIds.length}${duplicates ? ` · ${messages.duplicates} ${duplicates}` : ''}`,
      );
    } catch (reason) {
      notify(`${messages.importFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  }, [applyImportedOutputs, busy, messages, notify, preview, refresh]);

  const chooseFiles = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const context = createContext('UPLOAD');
      const rows = await window.desktopApi.creatorOutputsChoose({ context });
      if (rows) setPreview({ context, rows });
    } catch (reason) {
      notify(`${messages.importFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  }, [busy, createContext, messages.importFailed, notify]);

  const dismiss = useCallback(() => {
    const stageIds = preview?.rows?.flatMap((row) => row.item.stageId ?? []) ?? [];
    setPreview(null);
    if (stageIds.length)
      void window.desktopApi.creatorOutputsDiscard(stageIds).catch((reason) => {
        notify(reason instanceof Error ? reason.message : String(reason));
      });
  }, [notify, preview]);

  return { busy, preview, previewFiles, chooseFiles, commit, dismiss };
}
