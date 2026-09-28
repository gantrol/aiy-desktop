import { useEffect } from 'react';
import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import type { ArticleEditorLocationDto } from '@/shared/contracts';
import { captureArticleEditorLocation } from '@/renderer/features/video-documents/articleElementIdentity';
import { captureArticleViewportLocation } from '@/renderer/features/video-documents/articleEditorViewport';
import {
  outlineFocusNavigationMeta,
  outlineScrollContainer,
} from '@/renderer/features/content-editor/outlineViewState';

interface NavigationCallbacks {
  onArticleLocationChange?(location: ArticleEditorLocationDto): void;
  onArticleNavigationLocation?(location: ArticleEditorLocationDto): void;
}

/** Record the origin before selection events can replace it with the new scope. */
export function useOutlineFocusNavigation(editor: Editor | null, callbacks: { current: NavigationCallbacks }) {
  useEffect(() => {
    if (!editor) return;
    const before = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.getMeta(outlineFocusNavigationMeta) || !callbacks.current.onArticleNavigationLocation) return;
      const root = outlineScrollContainer(editor);
      const location = (root && captureArticleViewportLocation(editor, root)) ?? captureArticleEditorLocation(editor);
      if (location) callbacks.current.onArticleLocationChange?.(location);
    };
    const after = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.getMeta(outlineFocusNavigationMeta)) return;
      const location = captureArticleEditorLocation(editor);
      if (location) callbacks.current.onArticleNavigationLocation?.(location);
    };
    editor.on('beforeTransaction', before);
    editor.on('transaction', after);
    return () => {
      editor.off('beforeTransaction', before);
      editor.off('transaction', after);
    };
  }, [editor, callbacks]);
}
