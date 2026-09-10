import { createContext, useContext, type ReactNode } from 'react';
import type { WorkspaceVisualResumeDto } from '@/shared/contracts/workspace-layout';

const Context = createContext<{ spaceId: string; entries: readonly WorkspaceVisualResumeDto[] } | null>(null);
export function WorkspaceVisualResumeProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: { spaceId: string; entries: readonly WorkspaceVisualResumeDto[] } | null;
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useWorkspaceVisualResume(spaceId: string) {
  const context = useContext(Context);
  return (visualId: string) =>
    context?.spaceId === spaceId ? context.entries.find((entry) => entry.visualId === visualId) : undefined;
}
