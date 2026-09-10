import { beginImageImport, prepareContentImageStage } from '@/renderer/features/content-editor/contentImageRecovery';
import {
  hasContentImageImport,
  updateContentImageImport,
} from '@/renderer/features/content-editor/contentImageImportNodes';
import type { ImportedEditorImage } from '@/renderer/features/content-editor/contentImageAsset';
import type { CreatorImageImportSource } from '@/shared/contracts';
import type { Editor } from '@tiptap/core';

/** An import owns its placeholder, never the selection at the time its promise resolves. */
export function beginContentImageInsertion(
  editor: Editor,
  file: File,
  source: CreatorImageImportSource,
  importImage: (file: File, source: CreatorImageImportSource, importId?: string) => Promise<ImportedEditorImage>,
  imported: (image: ImportedEditorImage) => void,
  failed: () => void,
  existingImportId?: string,
) {
  const importId = existingImportId ?? crypto.randomUUID();
  const blockId = crypto.randomUUID();
  const finish = beginImageImport(editor, importId);
  const finishStage = prepareContentImageStage(importId);
  if (
    !existingImportId &&
    !editor.commands.insertContent({
      type: 'image',
      attrs: { blockId, importId, importState: 'pending', alt: file.name, src: '' },
    })
  ) {
    finish();
    finishStage();
    return Promise.resolve();
  }
  return Promise.resolve()
    .then(() => importImage(file, source, importId))
    .then((result) => {
      if (!hasContentImageImport(editor, importId)) return;
      imported(result);
      updateContentImageImport(editor, importId, {
        ...result.attributes,
        assetId: result.binding.assetId,
        importId: null,
        importState: null,
      });
    })
    .catch(() => {
      if (!hasContentImageImport(editor, importId)) return;
      updateContentImageImport(editor, importId, { importState: 'failed' });
      failed();
    })
    .finally(() => {
      finishStage();
      finish();
    });
}
