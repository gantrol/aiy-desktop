import {
  videoDocumentEditorImageFromAsset,
  type ImportedEditorImage,
} from '@/renderer/features/content-editor/contentImageAsset';
import {
  hasContentImageImport,
  updateContentImageImport,
} from '@/renderer/features/content-editor/contentImageImportNodes';
import { blockDocumentImportIds, type BlockDocument } from '@/shared/contracts/block-document';
import type { ContentImageStage } from '@/shared/contracts/content-image-import';
import type { Editor } from '@tiptap/core';

const staged = new Map<string, Promise<void>>();
const stageReceivers = new Map<string, (operation: Promise<void>) => void>();

/** Register before File.arrayBuffer, so a close/checkpoint can await the durable handoff itself. */
export function prepareContentImageStage(id: string) {
  let received = false;
  let rejectStage: (reason: Error) => void = () => {};
  const accepted = new Promise<void>((resolve, reject) => {
    rejectStage = reject;
    stageReceivers.set(id, (operation) => {
      received = true;
      void operation.then(resolve, reject);
    });
  });
  staged.set(id, accepted);
  void accepted
    .finally(() => {
      if (staged.get(id) === accepted) staged.delete(id);
      stageReceivers.delete(id);
    })
    .catch(() => undefined);
  return () => {
    if (!received) rejectStage(new Error('BLOCK_IMAGE_IMPORT_NOT_DURABLE'));
  };
}
const running = new WeakMap<Editor, Set<string>>();
export function beginImageImport(editor: Editor, id: string) {
  const ids = running.get(editor) ?? new Set<string>();
  ids.add(id);
  running.set(editor, ids);
  return () => {
    ids.delete(id);
  };
}
const callbacks = new WeakMap<
  Editor,
  { imported(image: ImportedEditorImage): void; failed(): void; track?(operation: Promise<void>): void }
>();
export function contentImageApi() {
  return window.desktopApi ?? window.desktopPetals;
}

export function stageContentImage(input: ContentImageStage) {
  const operation = contentImageApi().contentImageStage(input);
  const receiver = stageReceivers.get(input.importId);
  if (receiver) {
    receiver(operation);
    return operation;
  }
  staged.set(input.importId, operation);
  void operation
    .finally(() => {
      if (staged.get(input.importId) === operation) staged.delete(input.importId);
    })
    .catch(() => undefined);
  return operation;
}
export async function contentImagesRecoverable(document: BlockDocument) {
  try {
    for (const id of blockDocumentImportIds(document)) {
      const accepted = staged.get(id);
      if (accepted) await accepted;
      else if (!(await contentImageApi().contentImageAccepted(id))) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function retryContentImage(editor: Editor, id: string) {
  const handlers = callbacks.get(editor);
  if (!handlers) return;
  if (!hasContentImageImport(editor, id) || running.get(editor)?.has(id)) return;
  const finish = beginImageImport(editor, id);
  updateContentImageImport(editor, id, { importState: 'pending' });
  try {
    await staged.get(id);
    const asset = await contentImageApi().contentImageResolve(id);
    if (!hasContentImageImport(editor, id)) return;
    const image = videoDocumentEditorImageFromAsset(asset);
    handlers.imported(image);
    updateContentImageImport(editor, id, {
      ...image.attributes,
      assetId: asset.id,
      importId: null,
      importState: null,
    });
  } catch {
    if (!hasContentImageImport(editor, id)) return;
    updateContentImageImport(editor, id, { importState: 'failed' });
    handlers.failed();
  } finally {
    finish();
  }
}

export function registerContentImageRecovery(editor: Editor, handlers: NonNullable<ReturnType<typeof callbacks.get>>) {
  callbacks.set(editor, handlers);
  let active = true;
  let scheduled = false;
  let queue = Promise.resolve();
  const resume = () => {
    if (!active || scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!active || editor.isDestroyed) return;
      const ids = new Set<string>();
      editor.state.doc.descendants((node) => {
        if (
          node.type.name === 'image' &&
          node.attrs.importId &&
          node.attrs.importState !== 'failed' &&
          !running.get(editor)?.has(String(node.attrs.importId))
        )
          ids.add(String(node.attrs.importId));
      });
      if (!ids.size) return;
      queue = queue.then(async () => {
        for (const id of ids) {
          if (!active) return;
          await retryContentImage(editor, id);
        }
      });
      handlers.track?.(queue);
    });
  };
  editor.on('transaction', resume);
  resume();
  return () => {
    active = false;
    editor.off('transaction', resume);
    callbacks.delete(editor);
  };
}
