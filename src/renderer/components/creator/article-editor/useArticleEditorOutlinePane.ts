import { useCallback, useRef, useState } from 'react';
import type { ArticleEditorOutlineDepthLimit } from '@/renderer/components/creator/article-editor/articleEditorOutlineModel';
import {
  clampArticleEditorOutlineWidth,
  loadArticleEditorOutlinePreferences,
  maximumArticleEditorOutlineWidth,
  maximumArticleEditorMediaWidth,
  minimumArticleEditorOutlineWidth,
  saveArticleEditorOutlinePreferences,
  type ArticleEditorOutlinePreferences,
  type ArticleEditorPanePreferenceScope,
  type ArticleEditorSidebarPanel,
  type ArticleEditorSidebarSide,
} from '@/renderer/components/creator/article-editor/articleEditorOutlinePreferences';
import type { ArticleDocumentWidth } from '@/renderer/lib/articleTypography';

function panelWidth(preferences: ArticleEditorOutlinePreferences, panel: ArticleEditorSidebarPanel) {
  return panel === 'MEDIA' || panel === 'FILES'
    ? preferences.mediaWidth
    : panel === 'OUTLINE'
      ? preferences.outlineWidth
      : preferences.commentsWidth;
}

export function useArticleEditorOutlinePane(scope: ArticleEditorPanePreferenceScope = 'PRIMARY') {
  const [preferences, setPreferences] = useState(() => loadArticleEditorOutlinePreferences(scope));
  const preferencesRef = useRef(preferences);

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
      updatePreferences(
        panel === 'OUTLINE'
          ? { outlineExpanded: expanded }
          : panel === 'COMMENTS'
            ? { commentsExpanded: expanded }
            : { expanded },
      ),
    [updatePreferences],
  );
  const setPanelWidth = useCallback(
    (panel: ArticleEditorSidebarPanel, width: number) => {
      const nextWidth =
        panel === 'MEDIA' || panel === 'FILES'
          ? Math.min(maximumArticleEditorMediaWidth, Math.max(minimumArticleEditorOutlineWidth, Math.round(width)))
          : clampArticleEditorOutlineWidth(width);
      updatePreferences(
        panel === 'MEDIA' || panel === 'FILES'
          ? { mediaWidth: nextWidth }
          : panel === 'OUTLINE'
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

  return {
    preferences,
    minimumWidth: minimumArticleEditorOutlineWidth,
    maximumWidth:
      preferences.activePanel === 'MEDIA' || preferences.activePanel === 'FILES'
        ? maximumArticleEditorMediaWidth
        : maximumArticleEditorOutlineWidth,
    setExpanded,
    setDepthLimit,
    setFollowCursor,
    setActivePanel,
    setSide,
    setDocumentWidth,
    setPanelExpanded,
    setPanelWidth,
    getPanelWidth,
    replacePreferences,
  };
}
