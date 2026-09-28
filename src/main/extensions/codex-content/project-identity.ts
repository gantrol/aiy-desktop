import type { CodexSidebarState } from '@/main/extensions/codex-history-search/sidebar-state-reader';

/** Sidebar identity and app-server identity are distinct; never infer either from a shared root. */
export function codexAppServerProjectId(state: CodexSidebarState | null, projectId: string) {
  if (!state?.projects.some((project) => project.projectId === projectId))
    throw new Error('[aiy-codex-content:project]');
  if (state.localAppServerProjectIdByProjectId)
    return state.localAppServerProjectIdByProjectId.get(projectId) ?? projectId;
  const aliases = [...state.projectIdByLegacyProjectId].filter(([, localId]) => localId === projectId);
  if (aliases.length > 1) throw new Error('[aiy-codex-content:project]');
  return aliases[0]?.[0] ?? projectId;
}
