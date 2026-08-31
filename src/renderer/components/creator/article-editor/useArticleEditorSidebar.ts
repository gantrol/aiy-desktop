import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type {
  ArticleEditorPanePreferenceScope,
  ArticleEditorSidebarPanel,
} from '@/renderer/components/creator/article-editor/articleEditorOutlinePreferences';
import { useArticleEditorOutlinePane } from '@/renderer/components/creator/article-editor/useArticleEditorOutlinePane';

const minimumDockedSidebarContainerWidth = 960;
const minimumDualSidebarContainerWidth = 1480;

export type ArticleEditorSidebarMode = 'OVERLAY' | 'SINGLE' | 'DUAL';

export function useArticleEditorSidebar(
  containerRef: RefObject<HTMLElement | null>,
  comments: readonly { id: string }[] = [],
  {
    enabled = true,
    preferenceScope = 'PRIMARY',
  }: { enabled?: boolean; preferenceScope?: ArticleEditorPanePreferenceScope } = {},
) {
  const pane = useArticleEditorOutlinePane(preferenceScope);
  const { preferences, setActivePanel, setExpanded, setPanelExpanded } = pane;
  const [mode, setMode] = useState<ArticleEditorSidebarMode>('SINGLE');
  const [compactOpen, setCompactOpen] = useState(false);
  const commentIdsRef = useRef(new Set(comments.map((comment) => comment.id)));

  useLayoutEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const width = container.getBoundingClientRect().width;
      setMode(
        width < minimumDockedSidebarContainerWidth
          ? 'OVERLAY'
          : width < minimumDualSidebarContainerWidth
            ? 'SINGLE'
            : 'DUAL',
      );
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, enabled]);

  const panelOpen = useCallback(
    (panel: ArticleEditorSidebarPanel) => {
      if (mode === 'DUAL') return panel === 'OUTLINE' ? preferences.outlineExpanded : preferences.commentsExpanded;
      if (preferences.activePanel !== panel) return false;
      return mode === 'OVERLAY' ? compactOpen : preferences.expanded;
    },
    [compactOpen, mode, preferences],
  );

  const setPanelOpen = useCallback(
    (panel: ArticleEditorSidebarPanel, open: boolean) => {
      if (mode === 'DUAL') {
        setPanelExpanded(panel, open);
        if (open) setActivePanel(panel);
        return;
      }
      if (open) setActivePanel(panel);
      if (mode === 'OVERLAY') setCompactOpen(open);
      else setExpanded(open);
    },
    [mode, setActivePanel, setExpanded, setPanelExpanded],
  );

  const showPanel = useCallback((panel: ArticleEditorSidebarPanel) => setPanelOpen(panel, true), [setPanelOpen]);

  useEffect(() => {
    const nextIds = new Set(comments.map((comment) => comment.id));
    const added = comments.some((comment) => !commentIdsRef.current.has(comment.id));
    commentIdsRef.current = nextIds;
    if (added) showPanel('COMMENTS');
  }, [comments, showPanel]);

  const togglePanel = useCallback(
    (panel: ArticleEditorSidebarPanel) => {
      setPanelOpen(panel, !panelOpen(panel));
    },
    [panelOpen, setPanelOpen],
  );

  return {
    ...pane,
    compact: mode === 'OVERLAY',
    mode,
    open: panelOpen(preferences.activePanel),
    panelOpen,
    setPanelOpen,
    showPanel,
    togglePanel,
  };
}

export type ArticleEditorSidebarController = ReturnType<typeof useArticleEditorSidebar>;
