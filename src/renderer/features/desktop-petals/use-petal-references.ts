import type { NoteEditSession } from '@/renderer/features/desktop-petals/note-edit-session';
import type { ImportedEditorImage } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import { importVideoDocumentEditorImage } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import { contentAssetPath } from '@/shared/content-document';
import { petalReferenceFileSchema, type PetalReferenceCommand } from '@/shared/contracts/desktop-petals';
import { useCallback, useRef, type ClipboardEvent, type DragEvent } from 'react';
export type ReferenceChange =
  | { kind: 'upload' }
  | { kind: 'add' | 'remove'; assetId: string }
  | Omit<Extract<PetalReferenceCommand, { kind: 'import' }>, 'id' | 'expectedHash'>;

export function usePetalReferences(session: NoteEditSession, onError: (reason: unknown) => void) {
  const lastImport = useRef<ImportedEditorImage | null>(null);
  const pending = useRef<Promise<boolean> | null>(null);
  const change = (input: ReferenceChange): Promise<boolean> => {
    if (pending.current || !session.getSnapshot().note.editable || !session.setFrozen(true))
      return Promise.resolve(false);
    pending.current = (async () => {
      try {
        if (!(await session.flush())) return false;
        const note = session.getSnapshot().note;
        const result = await window.desktopPetals.references({ ...input, id: note.id, expectedHash: note.contentHash });
        if (!Array.isArray(result)) {
          session.receive(result);
          const image = result.importedImages?.[0];
          if (image) {
            const path = contentAssetPath(image.id);
            lastImport.current = {
              binding: {
                path,
                assetId: image.id,
                kind: 'IMAGE',
                timestampMs: null,
                endTimestampMs: null,
                posterAssetId: null,
              },
              media: { ...image, assetId: image.id, durationMs: null },
              attributes: { sourcePath: path, src: image.mediaUrl, alt: null, title: null },
            };
          }
        }
        return true;
      } catch (reason) {
        onError(reason);
        return false;
      } finally {
        session.setFrozen(false);
        pending.current = null;
      }
    })();
    return pending.current;
  };
  const files = async (selected: File[], source: 'PASTE' | 'DROP') => {
    if (session.getSnapshot().frozen || !session.getSnapshot().note.editable) return;
    try {
      if (
        selected.length + session.getSnapshot().note.references.length > 100 ||
        selected.some((file) => file.size > 25 * 1024 * 1024) ||
        selected.reduce((size, file) => size + file.size, 0) > 100 * 1024 * 1024
      )
        throw new Error('[aiy-petal:invalidSettings]');
      const items = await Promise.all(
        selected.map(async (file) =>
          petalReferenceFileSchema.parse({
            name: file.name || 'image.png',
            mimeType: file.type,
            bytes: new Uint8Array(await file.arrayBuffer()),
          }),
        ),
      );
      await change({ kind: 'import', source, items });
    } catch (reason) {
      onError(reason);
    }
  };
  const settle = useCallback(() => pending.current ?? Promise.resolve(true), []);
  return {
    async importImage(
      file: File,
      source: 'UPLOAD' | 'PASTE' | 'DROP',
      importId?: string,
    ): Promise<ImportedEditorImage> {
      if (session.getSnapshot().referenceAssetIds.length >= 100) throw new Error('[aiy-petal:invalidSettings]');
      return importVideoDocumentEditorImage(file, source, importId);
    },
    change,
    settle,
    onPaste(event: ClipboardEvent) {
      if (!event.clipboardData.files.length) return;
      event.preventDefault();
      void files([...event.clipboardData.files], 'PASTE');
    },
    onDragOver(event: DragEvent) {
      if (event.dataTransfer.types.includes('Files')) event.preventDefault();
    },
    onDrop(event: DragEvent) {
      if (!event.dataTransfer.files.length) return;
      event.preventDefault();
      void files([...event.dataTransfer.files], 'DROP');
    },
  };
}
