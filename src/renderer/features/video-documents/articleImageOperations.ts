import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { NodeSelection } from '@tiptap/pm/state';
import { ARTICLE_ELEMENT_ATTRIBUTE } from '@/renderer/features/video-documents/articleElementIdentityModel';

export interface ArticleImagePlacement {
  elementId: string;
  assetId: string;
  path: string;
}

function locatedImages(editor: Editor) {
  const images: { node: ProseMirrorNode; position: number; elementId: string }[] = [];
  if (editor.isDestroyed) return images;
  editor.state.doc.descendants((node, position) => {
    const elementId = node.attrs[ARTICLE_ELEMENT_ATTRIBUTE];
    if (node.type.name === 'image' && typeof elementId === 'string' && elementId)
      images.push({ node, position, elementId });
  });
  return images;
}

export function articleImagePlacements(editor: Editor): ArticleImagePlacement[] {
  return locatedImages(editor).map(({ elementId, node }) => ({
    elementId,
    assetId: String(node.attrs.assetId ?? ''),
    path: String(node.attrs.mediaPath || node.attrs.sourcePath || node.attrs.src || ''),
  }));
}

/** Move one occurrence, retaining its identity, attributes, and the surrounding text. */
export function moveArticleImage(editor: Editor, elementId: string, targetId: string) {
  if (editor.isDestroyed || !editor.isEditable || editor.view.composing || elementId === targetId) return false;
  const images = locatedImages(editor);
  const source = images.find((image) => image.elementId === elementId);
  const target = images.find((image) => image.elementId === targetId);
  if (!source || !target || source.node.attrs.importId || target.node.attrs.importId) return false;
  const destination = target.position + (source.position < target.position ? target.node.nodeSize : 0);
  const transaction = closeHistory(editor.state.tr);
  transaction.delete(source.position, source.position + source.node.nodeSize);
  const insertion = transaction.mapping.map(destination);
  const resolved = transaction.doc.resolve(insertion);
  if (!resolved.parent.canReplaceWith(resolved.index(), resolved.index(), source.node.type)) return false;
  transaction.insert(insertion, source.node);
  transaction.setSelection(NodeSelection.create(transaction.doc, insertion));
  editor.view.dispatch(transaction);
  editor.view.dispatch(closeHistory(editor.state.tr));
  return true;
}

export function removeArticleImage(editor: Editor, elementId: string) {
  if (editor.isDestroyed || !editor.isEditable || editor.view.composing) return false;
  const source = locatedImages(editor).find((image) => image.elementId === elementId);
  if (!source) return false;
  editor.view.dispatch(closeHistory(editor.state.tr).delete(source.position, source.position + source.node.nodeSize));
  editor.view.dispatch(closeHistory(editor.state.tr));
  return true;
}
