import { useEffect, useRef, useState } from 'react';
import type { AssetDto } from '@/shared/contracts';
import type { CreatorImageImportContext } from '@/shared/contracts/creator-import';
import { imageImportItems, type RendererImageImportSource } from '@/renderer/components/creator/imageImport';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

const MAX_REFERENCE_ASSETS = 8;

export type CreatorReferenceImportContext = Omit<CreatorImageImportContext, 'source' | 'sourceUrl'>;

type ReferenceAssetsUpdater = (update: (current: AssetDto[]) => AssetDto[]) => void;

interface UseCreatorReferenceImportOptions {
  context: CreatorReferenceImportContext;
  importFailedMessage: string;
  notify(message: string): void;
  scopeKey: string;
  updateReferenceAssets: ReferenceAssetsUpdater;
}

function sameReferenceOrder(left: AssetDto[], right: AssetDto[]) {
  return left.length === right.length && left.every((asset, index) => asset.id === right[index]?.id);
}

export function mergeCreatorReferenceAssets(current: AssetDto[], incoming: AssetDto[]) {
  const merged = [
    ...current,
    ...incoming.filter((asset) => !current.some((existing) => existing.id === asset.id)),
  ].slice(0, MAX_REFERENCE_ASSETS);
  return merged.length === current.length ? current : merged;
}

export function creatorReferenceImportContext(
  base: CreatorReferenceImportContext,
  source: RendererImageImportSource,
  sourceUrl = '',
): CreatorImageImportContext {
  return { ...base, source, sourceUrl };
}

export function useCreatorReferenceImport({
  context,
  importFailedMessage,
  notify,
  scopeKey,
  updateReferenceAssets,
}: UseCreatorReferenceImportOptions) {
  const [importing, setImporting] = useState(false);
  const importingRef = useRef(false);
  const mountedRef = useRef(false);
  const currentScopeKeyRef = useRef(scopeKey);
  currentScopeKeyRef.current = scopeKey;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      importingRef.current = false;
    };
  }, []);

  const applyIfCurrent = useStableCallback((capturedScopeKey: string, assets: AssetDto[]) => {
    if (!mountedRef.current || currentScopeKeyRef.current !== capturedScopeKey) return;
    updateReferenceAssets((current) => mergeCreatorReferenceAssets(current, assets));
  });

  const beginImport = useStableCallback(() => {
    if (importingRef.current) return false;
    importingRef.current = true;
    setImporting(true);
    return true;
  });

  const finishImport = useStableCallback(() => {
    importingRef.current = false;
    if (mountedRef.current) setImporting(false);
  });

  const attachReferences = useStableCallback(async () => {
    const capturedScopeKey = scopeKey;
    const result = await window.desktopApi.assetsChooseReferences();
    applyIfCurrent(capturedScopeKey, result.assets);
  });

  const importReferenceFiles = useStableCallback(
    async (files: File[], source: RendererImageImportSource, sourceUrl: string = '') => {
      if (!beginImport()) return;
      const capturedScopeKey = scopeKey;
      const capturedContext = creatorReferenceImportContext(context, source, sourceUrl);
      try {
        const items = await imageImportItems(files);
        if (!items.length) return;
        const assets = await window.desktopApi.creatorReferencesImport({
          context: capturedContext,
          items,
        });
        applyIfCurrent(capturedScopeKey, assets);
      } catch (reason) {
        notify(`${importFailedMessage}: ${reason instanceof Error ? reason.message : String(reason)}`);
      } finally {
        finishImport();
      }
    },
  );

  const importClipboardReference = useStableCallback(async (sourceUrl: string = '') => {
    if (!beginImport()) return;
    const capturedScopeKey = scopeKey;
    const capturedContext = creatorReferenceImportContext(context, 'PASTE', sourceUrl);
    try {
      const assets = await window.desktopApi.creatorClipboardReferenceImport({ context: capturedContext });
      applyIfCurrent(capturedScopeKey, assets);
    } catch (reason) {
      notify(`${importFailedMessage}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      finishImport();
    }
  });

  const removeReferenceAsset = useStableCallback((id: string) => {
    updateReferenceAssets((current) => {
      const next = current.filter((asset) => asset.id !== id);
      return next.length === current.length ? current : next;
    });
  });

  const applyReferenceAssets = useStableCallback((assets: AssetDto[]) => {
    updateReferenceAssets((current) => (sameReferenceOrder(current, assets) ? current : assets));
  });

  return {
    applyReferenceAssets,
    attachReferences,
    importClipboardReference,
    importReferenceFiles,
    referenceImporting: importing,
    removeReferenceAsset,
  };
}
