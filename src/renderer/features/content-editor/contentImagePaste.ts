import { clipboardHasUserText, clipboardImageFiles, imageMimeType } from '@/renderer/components/creator/imageImport';
import type { Editor } from '@tiptap/core';
import { Fragment, Slice, type Node } from '@tiptap/pm/model';

/** Match clipboard files to image slots before inserting the slice, retaining surrounding paragraphs. */
export function pasteContentImages(
  editor: Editor,
  event: ClipboardEvent,
  slice: Slice,
  enqueue: (files: readonly File[], source: 'PASTE', importIds?: readonly string[]) => void,
) {
  const clipboard = event.clipboardData;
  if (!clipboard) return false;
  const files = clipboardImageFiles(clipboard).filter((file) => imageMimeType(file));
  if (!files.length) return false;
  const importIds: string[] = [];
  const map = (node: Node): Node => {
    if (node.type.name === 'image' && importIds.length < files.length) {
      const id = crypto.randomUUID();
      importIds.push(id);
      return node.type.create({
        blockId: crypto.randomUUID(),
        importId: id,
        importState: 'pending',
        alt: node.attrs.alt || files[importIds.length - 1].name,
        title: node.attrs.title,
        src: '',
      });
    }
    if (node.isLeaf) return node;
    const children: Node[] = [];
    node.forEach((child) => children.push(map(child)));
    return node.copy(Fragment.fromArray(children));
  };
  const children: Node[] = [];
  slice.content.forEach((node) => children.push(map(node)));
  event.preventDefault();
  if (importIds.length || clipboardHasUserText(clipboard)) {
    editor.view.dispatch(
      editor.state.tr.replaceSelection(new Slice(Fragment.fromArray(children), slice.openStart, slice.openEnd)),
    );
  }
  enqueue(files, 'PASTE', importIds);
  return true;
}
