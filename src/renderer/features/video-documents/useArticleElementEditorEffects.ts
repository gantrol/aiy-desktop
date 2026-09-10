import { useCallback, useEffect } from 'react';
import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import type { ArticleCommentDto, ArticleElementPlacementInput } from '@/shared/contracts';
import {
  articleElementPlacements,
  hydrateArticleElements,
  reconcileArticleElementIdentities,
  refreshArticleElementDecorations,
} from '@/renderer/features/video-documents/articleElementIdentity';
import type { EditorCompositionPhase } from '@/renderer/features/video-documents/videoDocumentEditorComposition';
import type { VideoDocumentArticleElementsChangeReason } from '@/renderer/features/video-documents/videoDocumentEditorPublication';
import { useLatestMicrotask } from '@/renderer/hooks/useLatestMicrotask';

export function useArticleElementEditorEffects({
  editor,
  enabled,
  initialElements,
  callbacks,
  comments,
  compositionPhase,
  hydrationReady,
}: {
  editor: Editor | null;
  enabled: boolean;
  initialElements: { current: readonly ArticleElementPlacementInput[] };
  callbacks: {
    current: {
      onArticleElementsChange?: (
        elements: readonly ArticleElementPlacementInput[],
        reason: VideoDocumentArticleElementsChangeReason,
      ) => void;
    };
  };
  comments: readonly ArticleCommentDto[] | undefined;
  compositionPhase: { current: EditorCompositionPhase };
  hydrationReady: { current: boolean };
}) {
  useEffect(() => {
    hydrationReady.current = !enabled;
    if (!enabled || !editor) return undefined;
    let cancelled = false;
    let frame: number | null = null;

    const hydrateWhenSettled = () => {
      if (cancelled || editor.isDestroyed) return;
      if (compositionPhase.current !== 'idle' || editor.view.composing) {
        frame = window.requestAnimationFrame(hydrateWhenSettled);
        return;
      }
      hydrateArticleElements(editor, initialElements.current);
      const elements = articleElementPlacements(editor);
      hydrationReady.current = true;
      callbacks.current.onArticleElementsChange?.(elements, 'hydrate');
    };

    queueMicrotask(hydrateWhenSettled);
    return () => {
      cancelled = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [callbacks, compositionPhase, editor, enabled, hydrationReady, initialElements]);

  useLatestMicrotask(enabled ? editor : null, comments, (currentEditor) => {
    if (currentEditor.isDestroyed || compositionPhase.current !== 'idle' || currentEditor.view.composing) return;
    refreshArticleElementDecorations(currentEditor);
  });

  return useCallback(
    (view: EditorView) => {
      if (!editor || editor.isDestroyed || !enabled || view.composing) return false;
      const identityChanged = hydrationReady.current
        ? reconcileArticleElementIdentities(editor, view)
        : hydrateArticleElements(editor, initialElements.current, view);
      refreshArticleElementDecorations(editor, view);
      return hydrationReady.current && identityChanged;
    },
    [editor, enabled, hydrationReady, initialElements],
  );
}
