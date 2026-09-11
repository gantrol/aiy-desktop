import { useCallback, useRef, useState, type ClipboardEvent, type DragEvent, type RefObject } from 'react';
import { hasExternalFilesDrag, hasMaterialsDrag, readMaterialsDrag } from '@/renderer/components/albums/albumDrag';
import {
  clipboardImageFiles,
  imageFiles,
  imageImportItems,
  imageMimeType,
  transferSourceUrl,
  type RendererImageImportSource,
} from '@/renderer/components/creator/imageImport';
import type { NoteEditSession } from '@/renderer/features/desktop-petals/note-edit-session';
import type { VideoDocumentWysiwygEditorHandle } from '@/renderer/features/video-documents/videoDocumentEditorTypes';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { AssetDto, Locale } from '@/shared/contracts';

const mediaLimit = 100;
const importBatchLimit = 8;

export function useNoteMediaIntake({
  editorHandle,
  locale,
  notify,
  session,
}: {
  editorHandle: RefObject<VideoDocumentWysiwygEditorHandle | null>;
  locale: Locale;
  notify(message: string): void;
  session: NoteEditSession;
}) {
  const messages = useI18n().messages;
  const copy = messages.contentEditor.mediaIntake;
  const [adding, setAdding] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const pending = useRef<Promise<void> | null>(null);
  const settle = useCallback(() => pending.current ?? Promise.resolve(), []);

  function append(assets: readonly AssetDto[]) {
    const state = session.getSnapshot();
    const existing = new Set(state.referenceAssetIds);
    const accepted = assets
      .filter((asset, index) => !existing.has(asset.id) && assets.findIndex((item) => item.id === asset.id) === index)
      .slice(0, Math.max(0, mediaLimit - existing.size));
    if (!accepted.length) return 0;
    session.edit(state.text, { referenceAssetIds: [...state.referenceAssetIds, ...accepted.map((asset) => asset.id)] });
    return accepted.length;
  }

  function run(operation: () => Promise<void>) {
    if (pending.current) {
      notify(copy.importing);
      return pending.current;
    }
    setAdding(true);
    const current = operation().finally(() => {
      pending.current = null;
      setAdding(false);
    });
    pending.current = current;
    return current;
  }

  async function importFiles(files: readonly File[], source: RendererImageImportSource, sourceUrl = '') {
    const candidates = files.filter((file) => imageMimeType(file));
    if (!candidates.length) {
      notify(copy.onlyImages);
      return;
    }
    const state = session.getSnapshot();
    const capacity = Math.max(0, mediaLimit - state.referenceAssetIds.length);
    if (!capacity) {
      notify(copy.imageLimit.replace('{count}', String(mediaLimit)));
      return;
    }
    const selected = candidates.slice(0, capacity);
    let added = 0;
    try {
      for (let index = 0; index < selected.length; index += importBatchLimit) {
        const assets = await window.desktopApi.creatorReferencesImport({
          context: {
            seriesId: null,
            versionId: null,
            title: session.getSnapshot().title,
            titleLocale: locale,
            source,
            sourceUrl,
          },
          items: await imageImportItems(selected.slice(index, index + importBatchLimit)),
        });
        added += append(assets);
      }
      notify(added ? messages.contentEditor.imageAdded.replace('{count}', String(added)) : copy.alreadyAttached);
      if (selected.length < candidates.length) notify(copy.imageLimitReached.replace('{count}', String(mediaLimit)));
    } catch (reason) {
      const detail = reason instanceof Error ? reason.message : String(reason);
      notify(
        added
          ? messages.contentEditor.partialImageImport.replace('{count}', String(added)).replace('{detail}', detail)
          : detail,
      );
    }
  }

  async function choose() {
    try {
      const result = await window.desktopApi.assetsChooseReferences();
      const added = append(result.assets);
      if (result.assets.length && !added) notify(copy.selectionAttached);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function addMaterials(dataTransfer: DataTransfer) {
    const state = session.getSnapshot();
    const capacity = Math.max(0, mediaLimit - state.referenceAssetIds.length);
    if (!capacity) {
      notify(copy.imageLimit.replace('{count}', String(mediaLimit)));
      return;
    }
    const targets = readMaterialsDrag(dataTransfer).slice(0, capacity);
    if (!targets.length) return;
    try {
      const added = append(await window.desktopApi.materialImageAssetsResolve({ targets }));
      notify(added ? messages.contentEditor.imageAdded.replace('{count}', String(added)) : copy.alreadyAttached);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return {
    adding,
    dragActive,
    choose: () => run(choose),
    settle,
    remove: async (assetId: string) => {
      editorHandle.current?.removeImageAssets([assetId]);
      const state = session.getSnapshot();
      session.edit(state.text, {
        referenceAssetIds: state.referenceAssetIds.filter((candidate) => candidate !== assetId),
      });
      return session.flush();
    },
    paste(event: ClipboardEvent) {
      const files = clipboardImageFiles(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      void run(() => importFiles(files, 'PASTE', transferSourceUrl(event.clipboardData)));
    },
    dragOver(event: DragEvent) {
      if (!hasMaterialsDrag(event.dataTransfer) && !hasExternalFilesDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setDragActive(true);
    },
    dragLeave() {
      setDragActive(false);
    },
    drop(event: DragEvent) {
      if (hasMaterialsDrag(event.dataTransfer)) {
        event.preventDefault();
        setDragActive(false);
        void run(() => addMaterials(event.dataTransfer));
        return;
      }
      if (!hasExternalFilesDrag(event.dataTransfer)) return;
      event.preventDefault();
      setDragActive(false);
      void run(() => importFiles(imageFiles(event.dataTransfer.files), 'DROP', transferSourceUrl(event.dataTransfer)));
    },
  };
}
