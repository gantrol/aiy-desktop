import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import type { Editor } from '@tiptap/core';
import type { ArticleEditorSessionRuntime } from '@/renderer/components/creator/article-editor/ArticleEditorSessionRuntime';
import type { ContentInputOperations } from '@/renderer/features/content-editor/contentInputOperations';

export interface ActiveSharedEditor {
  editor: Editor;
  session: ArticleEditorSessionRuntime;
  inputs: ContentInputOperations;
}
export const ActiveContentEditor = createContext<{
  active: ActiveSharedEditor | null;
  activate: Dispatch<SetStateAction<ActiveSharedEditor | null>>;
}>({ active: null, activate: () => undefined });
export const useActiveContentEditor = () => useContext(ActiveContentEditor);
