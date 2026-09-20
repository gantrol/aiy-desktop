import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  outlineParentIds,
  outlineViewState,
  toggleOutlineAllParents,
} from '@/renderer/features/content-editor/outlineViewState';

/** The outer rail is a quiet, full-tree shortcut; individual branch rails remain local. */
export function OutlineGlobalCollapseRail({ editor }: { editor: Editor }) {
  const copy = useI18n().messages.referenceOutline;
  const { canCollapse, hasParents } = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      const view = outlineViewState(current.state);
      const parentIds = outlineParentIds(current.state.doc, view.focus);
      return {
        canCollapse: parentIds.some((id) => !view.folded.has(id)),
        hasParents: parentIds.length > 0,
      };
    },
  });
  if (!hasParents) return null;
  const label = canCollapse ? copy.collapseAllParents : copy.expandAllParents;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      contentEditable={false}
      data-outline-control
      data-outline-global-rail
      data-state={canCollapse ? 'open' : 'closed'}
      aria-label={label}
      aria-pressed={canCollapse}
      title={label}
      className="group/outline-global-rail absolute inset-y-0 -left-3 z-10 h-auto w-4 rounded-none p-0 text-border-strong hover:bg-transparent hover:text-[var(--hierarchy-accent)] focus-visible:text-[var(--hierarchy-accent)] focus-visible:ring-offset-0"
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        event.stopPropagation();
        toggleOutlineAllParents(editor);
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-2 left-1/2 w-0.5 -translate-x-1/2 bg-current opacity-20 group-hover/outline-global-rail:w-px group-hover/outline-global-rail:opacity-100 group-focus-visible/outline-global-rail:w-px group-focus-visible/outline-global-rail:opacity-100"
      />
    </Button>
  );
}
