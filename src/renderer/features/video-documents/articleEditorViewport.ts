import type { Editor } from '@tiptap/core';
import type { ArticleEditorLocationDto } from '@/shared/contracts';
import {
  articleElementForLocation,
  articleElementIndexForEditor,
} from '@/renderer/features/video-documents/articleElementIdentity';
import { outlineNavigationFocus } from '@/renderer/features/content-editor/outlineViewState';
import {
  afterOutlineFocusRestored,
  restoreOutlineNavigationFocus,
} from '@/renderer/features/content-editor/outlineFocusRestoration';

const ARTICLE_VIEWPORT_INSET_PX = 24;

export function captureArticleViewportLocation(editor: Editor, scrollRoot: HTMLElement) {
  if (editor.isDestroyed) return null;
  const rootRect = scrollRoot.getBoundingClientRect();
  const editorRect = editor.view.dom.getBoundingClientRect();
  const position = editor.view.posAtCoords({
    left: Math.min(editorRect.right - 1, editorRect.left + ARTICLE_VIEWPORT_INSET_PX),
    top: rootRect.top + ARTICLE_VIEWPORT_INSET_PX,
  })?.pos;
  const elements = articleElementIndexForEditor(editor).elements;
  const located =
    (position === undefined
      ? null
      : elements
          .filter(
            (candidate) => candidate.position <= position && position <= candidate.position + candidate.node.nodeSize,
          )
          .at(-1)) ??
    elements.find((candidate) => {
      const dom = editor.view.nodeDOM(candidate.position);
      return dom instanceof Element && dom.getBoundingClientRect().bottom >= rootRect.top;
    });
  if (!located) return null;
  const elementDom = editor.view.nodeDOM(located.position);
  const viewportOffset =
    elementDom instanceof Element
      ? Math.max(0, Math.round(rootRect.top + ARTICLE_VIEWPORT_INSET_PX - elementDom.getBoundingClientRect().top))
      : undefined;
  return {
    elementId: located.elementId,
    relativeOffset:
      position === undefined ? 0 : Math.max(0, Math.min(position - located.position - 1, located.node.content.size)),
    blockIndex: located.blockIndex,
    outlineFocusId: outlineNavigationFocus(editor.state),
    ...(viewportOffset === undefined ? {} : { viewportOffset }),
  } satisfies ArticleEditorLocationDto;
}

export function revealArticleEditorLocation(
  editor: Editor,
  location: ArticleEditorLocationDto,
  scrollRoot: HTMLElement,
) {
  if (editor.isDestroyed) return false;
  if (restoreOutlineNavigationFocus(editor, location.outlineFocusId)) {
    afterOutlineFocusRestored(editor, () => revealArticleEditorLocation(editor, location, scrollRoot));
    return true;
  }
  const located = articleElementForLocation(editor, location);
  if (!located) return false;
  const rootRect = scrollRoot.getBoundingClientRect();
  const elementDom = editor.view.nodeDOM(located.position);
  if (location.viewportOffset !== undefined && elementDom instanceof Element) {
    const elementRect = elementDom.getBoundingClientRect();
    const offset = Math.min(location.viewportOffset, Math.max(0, Math.round(elementRect.height)));
    scrollRoot.scrollTop +=
      elementRect.top + offset - rootRect.top - Math.min(ARTICLE_VIEWPORT_INSET_PX, rootRect.height / 4);
    return true;
  }
  const position = Math.min(
    located.position + 1 + location.relativeOffset,
    located.position + Math.max(located.node.nodeSize - 1, 1),
  );
  const coords = editor.view.coordsAtPos(position);
  scrollRoot.scrollTop += coords.top - rootRect.top - rootRect.height / 2;
  return true;
}
