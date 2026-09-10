import { createContext, useContext, type ReactNode } from 'react';
import { useCodexContent } from '@/renderer/features/extensions/codex-content/use-codex-content';

const CodexNoteContext = createContext<(ReturnType<typeof useCodexContent> & { available: boolean }) | null>(null);

/** One subscription follows the note through collapsed, expanded and extension-panel views. */
export function CodexNoteProvider({
  stashId,
  persisted,
  available,
  children,
}: {
  stashId: string;
  persisted: boolean;
  available: boolean;
  children: ReactNode;
}) {
  const content = useCodexContent(stashId, available && persisted);
  return <CodexNoteContext.Provider value={{ ...content, available }}>{children}</CodexNoteContext.Provider>;
}

export function useCodexNoteContent() {
  const value = useContext(CodexNoteContext);
  if (!value) throw new Error('Codex note controls require a note provider');
  return value;
}
