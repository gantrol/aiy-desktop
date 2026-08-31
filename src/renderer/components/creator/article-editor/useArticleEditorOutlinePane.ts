import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ArticleEditorOutlineDepthLimit } from '@/renderer/components/creator/article-editor/articleEditorOutlineModel';
import {
  clampArticleEditorOutlineWidth,
  loadArticleEditorOutlinePreferences,
  maximumArticleEditorOutlineWidth,
  minimumArticleEditorOutlineWidth,
  saveArticleEditorOutlinePreferences,
  type ArticleEditorOutlinePreferences,
  type ArticleEditorPanePreferenceScope,
  type ArticleEditorSidebarPanel,
  type ArticleEditorSidebarSide,
} from '@/renderer/components/creator/article-editor/articleEditorOutlinePreferences';
import type { ArticleDocumentWidth } from '@/renderer/lib/articleTypography';

function panelWidth(preferences: ArticleEditorOutlinePreferences, panel: ArticleEditorSidebarPanel) {
  return panel === 'OUTLINE' ? preferences.outlineWidth : preferences.commentsWidth;
}

export function useArticleEditorOutlinePane(scope: ArticleEditorPanePreferenceScope = 'PRIMARY') {
  const [preferences, setPreferences] = useState(() => loadArticleEditorOutlinePreferences(scope));
  const preferencesRef = useRef(preferences);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  const updatePreferences = useCallback(
    (update: Partial<ArticleEditorOutlinePreferences>) => {
      setPreferences((current) => {
        const next = { ...current, ...update };
        preferencesRef.current = next;
        saveArticleEditorOutlinePreferences(next, scope);
        return next;
      });
    },
    [scope],
  );
  const replacePreferences = useCallback(
    (next: ArticleEditorOutlinePreferences) => {
      const snapshot = { ...next };
      preferencesRef.current = snapshot;
      setPreferences(snapshot);
      saveArticleEditorOutlinePreferences(snapshot, scope);
    },
    [scope],
  );

  const setExpanded = useCallback((expanded: boolean) => updatePreferences({ expanded }), [updatePreferences]);
  const setDepthLimit = useCallback(
    (depthLimit: ArticleEditorOutlineDepthLimit) => updatePreferences({ depthLimit }),
    [updatePreferences],
  );
  const setFollowCursor = useCallback(
    (followCursor: boolean) => updatePreferences({ followCursor }),
    [updatePreferences],
  );
  const setActivePanel = useCallback(
    (activePanel: ArticleEditorSidebarPanel) => updatePreferences({ activePanel }),
    [updatePreferences],
  );
  const setSide = useCallback((side: ArticleEditorSidebarSide) => updatePreferences({ side }), [updatePreferences]);
  const setDocumentWidth = useCallback(
    (documentWidth: ArticleDocumentWidth) => updatePreferences({ documentWidth }),
    [updatePreferences],
  );
  const setPanelExpanded = useCallback(
    (panel: ArticleEditorSidebarPanel, expanded: boolean) =>
      updatePreferences(panel === 'OUTLINE' ? { outlineExpanded: expanded } : { commentsExpanded: expanded }),
    [updatePreferences],
  );
  const setPanelWidth = useCallback(
    (panel: ArticleEditorSidebarPanel, width: number) => {
      const nextWidth = clampArticleEditorOutlineWidth(width);
      updatePreferences(
        panel === 'OUTLINE'
          ? { outlineWidth: nextWidth, width: nextWidth }
          : { commentsWidth: nextWidth, width: nextWidth },
      );
    },
    [updatePreferences],
  );
  const getPanelWidth = useCallback(
    (panel: ArticleEditorSidebarPanel) => panelWidth(preferencesRef.current, panel),
    [],
  );

  const beginResize = useCallback(
    (panel: ArticleEditorSidebarPanel, edge: ArticleEditorSidebarSide, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      resizeCleanupRef.current?.();
      const startX = event.clientX;
      const startWidth = panelWidth(preferencesRef.current, panel);
      const previousCursor = document.body.style.cursor;
      const previousSelection = document.body.style.userSelect;
      let active = true;
      let currentWidth = startWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const move = (pointer: PointerEvent) => {
        const delta = pointer.clientX - startX;
        currentWidth = clampArticleEditorOutlineWidth(edge === 'LEFT' ? startWidth - delta : startWidth + delta);
        setPreferences((current) => {
          const next = {
            ...current,
            width: currentWidth,
            ...(panel === 'OUTLINE' ? { outlineWidth: currentWidth } : { commentsWidth: currentWidth }),
          };
          preferencesRef.current = next;
          return next;
        });
      };
      const finish = () => {
        if (!active) return;
        active = false;
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousSelection;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', finish);
        window.removeEventListener('pointercancel', finish);
        window.removeEventListener('blur', finish);
        saveArticleEditorOutlinePreferences(preferencesRef.current, scope);
        if (resizeCleanupRef.current === finish) resizeCleanupRef.current = null;
      };

      resizeCleanupRef.current = finish;
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', finish);
      window.addEventListener('pointercancel', finish);
      window.addEventListener('blur', finish);
    },
    [scope],
  );

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  return {
    preferences,
    minimumWidth: minimumArticleEditorOutlineWidth,
    maximumWidth: maximumArticleEditorOutlineWidth,
    setExpanded,
    setDepthLimit,
    setFollowCursor,
    setActivePanel,
    setSide,
    setDocumentWidth,
    setPanelExpanded,
    setPanelWidth,
    getPanelWidth,
    beginResize,
    replacePreferences,
  };
}
