import { useState } from 'react';
import type { ProjectCommand, ProjectCommandScan } from '@/shared/contracts/project-commands';

interface Draft {
  candidates: ProjectCommand[] | null;
  issues: ProjectCommandScan['issues'];
  editing: ProjectCommand | null;
  group: ProjectCommand['group'];
}
// Session-only drafts survive project/tab navigation. Command text is never sent to a service.
const drafts = new Map<string, Draft>();
export function useProjectCommandDraft(projectId: string) {
  const [draft, setDraft] = useState<Draft>(
    () => drafts.get(projectId) ?? { candidates: null, issues: [], editing: null, group: 'run' },
  );
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (next.candidates || next.editing) drafts.set(projectId, next);
      else drafts.delete(projectId);
      return next;
    });
  return { ...draft, set };
}
