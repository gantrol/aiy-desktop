import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useWorkspaceArticleEditorState } from '@/renderer/components/workspace/WorkspaceArticleEditorStateProvider';
import { focusContentBlock } from '@/renderer/features/content-editor/ContentDocumentOutline';
import type { ContentSource } from '@/shared/contracts/content-source';

/** Stable-block requests never fall back to a nearby element, heading or text match. */
export function useContentBlockNavigation(editor: Editor | null, source?: ContentSource) {
  const navigation = useWorkspaceArticleEditorState(source?.kind === 'ARTICLE' ? source.id : '');
  const [missing, setMissing] = useState(false);
  const blockId = navigation.articleLocation?.blockId;
  const referenceId = navigation.articleLocation?.referenceId;
  useEffect(() => {
    setMissing(false);
    if (!editor || editor.isDestroyed || !blockId || !navigation.navigationEntryId) return;
    const editorDom = editor.view.dom;
    let frame = 0;
    let active = true;
    let attempted = false;
    let highlight: Animation | undefined;
    const reveal = () => {
      if (!active || attempted || editor.isDestroyed || editor.view.composing) return;
      attempted = true;
      if (referenceId) {
        let matchingUse = false;
        editor.state.doc.descendants((node) => {
          if (
            node.attrs.blockId === blockId &&
            node.type.name === 'contentReference' &&
            node.attrs.referenceId === referenceId
          )
            matchingUse = true;
        });
        if (!matchingUse) {
          setMissing(true);
          return;
        }
      }
      if (!focusContentBlock(editor, blockId)) {
        setMissing(true);
        return;
      }
      // Selection reveals folded ancestors. Wait for their NodeViews before measuring.
      frame = window.requestAnimationFrame(() => {
        if (!active || editor.isDestroyed) return;
        editor.state.doc.descendants((node, position) => {
          if (node.attrs.blockId !== blockId) return;
          const element = editor.view.nodeDOM(position);
          if (!(element instanceof HTMLElement)) return;
          element.scrollIntoView({ block: 'center', inline: 'nearest' });
          if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches)
            highlight = element.animate(
              [
                { outline: '2px solid currentColor', outlineOffset: '3px' },
                { outline: '2px solid transparent', outlineOffset: '3px' },
              ],
              { duration: 1600 },
            );
        });
      });
    };
    frame = window.requestAnimationFrame(reveal);
    const settled = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(reveal);
    };
    editorDom.addEventListener('compositionend', settled);
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      highlight?.cancel();
      editorDom.removeEventListener('compositionend', settled);
    };
  }, [editor, blockId, referenceId, navigation.navigationEntryId]);
  return missing;
}
