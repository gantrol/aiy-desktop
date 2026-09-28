import { useState } from 'react';
import type { ContentSource } from '@/shared/contracts/content-source';

function readCollapsed(key: string | null) {
  if (!key) return false;
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

/** Folding belongs to this placement, independent of source or host content revisions. */
export function useReferenceCollapsePreference(
  source: ContentSource | undefined,
  spaceId: string | null,
  blockId: string,
) {
  const key =
    source && blockId
      ? `aiy.reference-collapsed.v1:${JSON.stringify([
          spaceId,
          source.kind,
          source.id,
          source.branchId ?? null,
          source.noteId ?? null,
          blockId,
        ])}`
      : null;
  const [state, setState] = useState(() => ({ key, collapsed: readCollapsed(key) }));
  const current = state.key === key ? state : { key, collapsed: readCollapsed(key) };
  if (state.key !== key) setState(current);

  const setCollapsed = (collapsed: boolean) => {
    if (key) {
      try {
        localStorage.setItem(key, String(collapsed));
      } catch {
        // Folding remains available when local preference storage is unavailable.
      }
    }
    setState({ key, collapsed });
  };
  return [current.collapsed, setCollapsed] as const;
}
