import { createContext, useContext, useId, type ReactNode } from 'react';

const WorkbenchScope = createContext<string | null>(null);

export function WorkbenchScopeProvider({ scope, children }: { scope: string; children: ReactNode }) {
  return <WorkbenchScope value={scope}>{children}</WorkbenchScope>;
}

/** Layout preferences belong to a space and workspace tab, not to the application window. */
export function useWorkbenchScopeKey(feature: string) {
  const scope = useContext(WorkbenchScope);
  const fallback = useId();
  return `${scope ?? fallback}:${feature}`;
}
