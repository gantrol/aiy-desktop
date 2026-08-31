import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from 'react';
import type { ArticleEditorLocationDto, WorkspaceArticleEditorStateDto } from '@/shared/contracts';

interface WorkspaceArticleEditorStateContextValue {
  activeArticleId: string | null;
  tabId: string;
  navigationEntryId: string;
  articleLocation: ArticleEditorLocationDto | null;
  editable: boolean;
  states: readonly WorkspaceArticleEditorStateDto[];
  update(
    articleId: string,
    operation: (current: WorkspaceArticleEditorStateDto | null) => WorkspaceArticleEditorStateDto | null,
  ): void;
  updateArticleLocation(articleId: string, location: ArticleEditorLocationDto): void;
  navigateArticleLocation(articleId: string, location: ArticleEditorLocationDto): void;
  requestEditOwnership(articleId: string): void;
  registerLocationFlush(articleId: string, flush: (() => void) | null): void;
}

const WorkspaceArticleEditorStateContext = createContext<WorkspaceArticleEditorStateContextValue | null>(null);

export function WorkspaceArticleEditorStateProvider({
  children,
  activeArticleId,
  tabId,
  navigationEntryId,
  articleLocation,
  editable,
  states,
  onChange,
  onArticleLocationChange,
  onArticleLocationNavigate,
  onRequestEditOwnership,
  onLocationFlushChange,
}: {
  children: ReactNode;
  activeArticleId: string | null;
  tabId: string;
  navigationEntryId: string;
  articleLocation: ArticleEditorLocationDto | null;
  editable: boolean;
  states: readonly WorkspaceArticleEditorStateDto[];
  onChange: WorkspaceArticleEditorStateContextValue['update'];
  onArticleLocationChange(articleId: string, location: ArticleEditorLocationDto): void;
  onArticleLocationNavigate(articleId: string, location: ArticleEditorLocationDto): void;
  onRequestEditOwnership(articleId: string): void;
  onLocationFlushChange(flush: (() => void) | null): void;
}) {
  const locationFlushersRef = useRef(new Map<string, () => void>());
  const flushLocations = useCallback(() => {
    [...locationFlushersRef.current.values()].forEach((flush) => flush());
  }, []);
  const registerLocationFlush = useCallback(
    (articleId: string, flush: (() => void) | null) => {
      if (flush) locationFlushersRef.current.set(articleId, flush);
      else locationFlushersRef.current.delete(articleId);
      onLocationFlushChange(locationFlushersRef.current.size ? flushLocations : null);
    },
    [flushLocations, onLocationFlushChange],
  );
  const value = useMemo<WorkspaceArticleEditorStateContextValue>(
    () => ({
      activeArticleId,
      tabId,
      navigationEntryId,
      articleLocation,
      editable,
      states,
      update: onChange,
      updateArticleLocation: onArticleLocationChange,
      navigateArticleLocation: onArticleLocationNavigate,
      requestEditOwnership: onRequestEditOwnership,
      registerLocationFlush,
    }),
    [
      activeArticleId,
      articleLocation,
      editable,
      navigationEntryId,
      onArticleLocationChange,
      onArticleLocationNavigate,
      onChange,
      onRequestEditOwnership,
      registerLocationFlush,
      states,
      tabId,
    ],
  );
  return (
    <WorkspaceArticleEditorStateContext.Provider value={value}>{children}</WorkspaceArticleEditorStateContext.Provider>
  );
}

export function useWorkspaceArticleEditorState(articleId: string) {
  const context = useContext(WorkspaceArticleEditorStateContext);
  const state = context?.states.find((candidate) => candidate.articleId === articleId) ?? null;
  const update = useCallback(
    (operation: (current: WorkspaceArticleEditorStateDto | null) => WorkspaceArticleEditorStateDto | null) =>
      context?.update(articleId, operation),
    [articleId, context],
  );
  const updateArticleLocation = useCallback(
    (location: ArticleEditorLocationDto) => {
      if (!context) return;
      if (context.activeArticleId === articleId) {
        context.updateArticleLocation(articleId, location);
        return;
      }
      context.update(articleId, (current) => ({
        ...(current ?? { articleId, editTrail: [] }),
        articleId,
        resumeLocation: location,
      }));
    },
    [articleId, context],
  );
  const navigateArticleLocation = useCallback(
    (location: ArticleEditorLocationDto) => {
      if (!context) return;
      if (context.activeArticleId === articleId) {
        context.navigateArticleLocation(articleId, location);
        return;
      }
      context.update(articleId, (current) => ({
        ...(current ?? { articleId, editTrail: [] }),
        articleId,
        resumeLocation: location,
      }));
    },
    [articleId, context],
  );
  const requestEditOwnership = useCallback(() => context?.requestEditOwnership(articleId), [articleId, context]);
  const registerLocationFlush = useCallback(
    (flush: (() => void) | null) => context?.registerLocationFlush(articleId, flush),
    [articleId, context],
  );
  return {
    state,
    update,
    tabId: context?.tabId ?? '',
    navigationEntryId: context?.activeArticleId === articleId ? context.navigationEntryId : '',
    articleLocation: context?.activeArticleId === articleId ? context.articleLocation : null,
    editable: context?.editable ?? true,
    updateArticleLocation,
    navigateArticleLocation,
    requestEditOwnership,
    registerLocationFlush,
  };
}
