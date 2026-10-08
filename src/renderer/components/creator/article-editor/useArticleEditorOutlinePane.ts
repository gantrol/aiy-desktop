import { useCallback, useState } from 'react';
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

export function useArticleEditorOutlinePane(
  scope: ArticleEditorPanePreferenceScope = 'PRIMARY',
  initialPanel: ArticleEditorSidebarPanel = 'OUTLINE',
) {
  const [preferences, setPreferences] = useState(() => loadArticleEditorOutlinePreferences(scope, initialPanel));

  const updatePreferences = useCallback(
    (update: Partial<ArticleEditorOutlinePreferences>) => {
      setPreferences((current) => {
        const next = { ...current, ...update };
        saveArticleEditorOutlinePreferences(next, scope);
        return next;
      });
    },
    [scope],
  );
  const replacePreferences = useCallback(
    (next: ArticleEditorOutlinePreferences) => {
      const snapshot = { ...next };
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
    (width: number) => updatePreferences({ width: clampArticleEditorOutlineWidth(width) }),
    [updatePreferences],
  );
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
    replacePreferences,
  };
}
