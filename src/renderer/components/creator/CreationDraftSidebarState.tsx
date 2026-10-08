import { createContext, useContext, type ReactNode } from 'react';

/** Draft list updates stay inside the sidebar slots without rebuilding the work tree. */
export const CreationDraftSidebarState = createContext<{
  content: ReactNode;
  feedback: ReactNode;
  hasContent: boolean;
}>({
  content: null,
  feedback: null,
  hasContent: false,
});

export function CreationDraftSidebarContent() {
  return useContext(CreationDraftSidebarState).content;
}

export function CreationDraftSidebarFeedback() {
  return useContext(CreationDraftSidebarState).feedback;
}
