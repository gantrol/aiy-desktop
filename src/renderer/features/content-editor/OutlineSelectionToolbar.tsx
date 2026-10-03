import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { Copy, CornerDownRight, FilePlus2, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  deleteOutlineSelection,
  moveSelectedOutlineItemsByOne,
  outlineSelectionCapabilities,
  shiftSelectedOutlineItems,
} from '@/renderer/features/content-editor/outlineEditing';
import {
  copyOutlineSelectionToClipboard,
  cutOutlineSelectionToClipboard,
  pasteOutlineSelectionFromClipboard,
} from '@/renderer/features/content-editor/outlineClipboard';
import {
  outlineViewState,
  setOutlineView,
  setSelectedOutlineItemsFolded,
} from '@/renderer/features/content-editor/outlineViewState';
import {
  OutlineSelectionMoreMenu,
  type OutlineMoreAction,
} from '@/renderer/features/content-editor/OutlineSelectionMoreMenu';
import { useOutlinePageAction } from '@/renderer/features/content-editor/useOutlinePageAction';
import { OutlineMoveDialog } from '@/renderer/features/content-editor/OutlineMoveDialog';
import { activeOutlineView, focusOutlineView } from '@/renderer/features/content-editor/outlineActiveView';

type Action = 'up' | 'down' | 'indent' | 'outdent' | 'collapse' | 'expand' | 'copy' | 'cut' | 'paste' | 'delete';

function createActionState() {
  let action: Action | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => action,
    set: (next: Action | null) => {
      action = next;
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
const actionStates = new WeakMap<Editor, ReturnType<typeof createActionState>>();
function actionStateFor(editor: Editor) {
  let state = actionStates.get(editor);
  if (!state) {
    state = createActionState();
    actionStates.set(editor, state);
  }
  return state;
}

export function OutlineSelectionToolbar({ editor }: { editor: Editor }) {
  const { messages } = useI18n();
  const copy = messages.referenceOutline.selectionToolbar;
  const page = useOutlinePageAction(editor);
  const { capabilities, editable, selected } = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      capabilities: outlineSelectionCapabilities(current),
      editable: current.isEditable,
      selected: outlineViewState(current.state).selected,
    }),
  });
  const actionState = actionStateFor(editor);
  const busy = useSyncExternalStore(actionState.subscribe, actionState.get, actionState.get);
  const [status, setStatus] = useState<{ message: string; error: boolean } | null>(null);
  const [moveIds, setMoveIds] = useState<readonly string[]>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 6_000);
    return () => clearTimeout(timer);
  }, [status]);

  const run = async (action: Action, command: () => boolean | Promise<boolean>) => {
    const actionView = activeOutlineView(editor);
    if (actionState.get() || editor.isDestroyed || actionView.composing) return;
    const focusedBefore = actionView.dom.ownerDocument.activeElement;
    actionState.set(action);
    const count = capabilities.branchCount;
    const clipboard = action === 'copy' || action === 'cut' || action === 'paste';
    try {
      const completed = await command();
      if (!mounted.current || editor.isDestroyed) return;
      setStatus({
        error: !completed,
        message: completed
          ? action === 'paste'
            ? copy.pasted
            : action === 'delete'
              ? copy.deleted
              : copy.done(copy[action], count)
          : clipboard
            ? copy.clipboardUnavailable
            : copy.unavailable,
      });
    } catch {
      if (mounted.current)
        setStatus({ message: clipboard ? copy.clipboardUnavailable : copy.unavailable, error: true });
    } finally {
      actionState.set(null);
      if (
        !editor.isDestroyed &&
        mounted.current &&
        activeOutlineView(editor) === actionView &&
        actionView.dom.ownerDocument.activeElement === focusedBefore
      )
        focusOutlineView(editor, actionView);
    }
  };

  if (!selected.length && !status && !moveOpen) return null;
  const locked = busy !== null || page.busy || moveOpen || activeOutlineView(editor).composing;
  const moreCommands: Record<OutlineMoreAction, () => boolean | Promise<boolean>> = {
    up: () => moveSelectedOutlineItemsByOne(editor, -1),
    down: () => moveSelectedOutlineItemsByOne(editor, 1),
    indent: () => shiftSelectedOutlineItems(editor, false),
    outdent: () => shiftSelectedOutlineItems(editor, true),
    collapse: () => setSelectedOutlineItemsFolded(editor, true),
    expand: () => setSelectedOutlineItemsFolded(editor, false),
    cut: () => cutOutlineSelectionToClipboard(editor),
    paste: () => pasteOutlineSelectionFromClipboard(editor),
    delete: () => deleteOutlineSelection(editor),
  };

  return (
    <div data-outline-selection-toolbar className="sticky bottom-2 z-30 mx-2 mt-3 rounded-sm border bg-surface p-2">
      {selected.length > 0 && (
        <>
          <p className="px-1 pb-1 text-xs font-medium" aria-live="polite" aria-atomic="true">
            {copy.selection(capabilities.selectedCount, capabilities.branchCount)}
          </p>
          <div
            role="toolbar"
            aria-label={copy.title}
            aria-busy={busy !== null || page.busy}
            className="flex min-w-0 items-center gap-1 overflow-x-auto [&>button]:shrink-0"
            onMouseDown={(event) => event.preventDefault()}
          >
            {page.supported && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={locked || !editable || !capabilities.canDelete || capabilities.branchCount > 200}
                onClick={() => {
                  setStatus(null);
                  void page.create(outlineViewState(editor.state).selected);
                }}
              >
                {page.busy ? (
                  <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
                ) : (
                  <FilePlus2 aria-hidden className="size-3.5" />
                )}
                {messages.referenceOutline.turnIntoPage}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={locked || !capabilities.branchCount}
              onClick={() => void run('copy', () => copyOutlineSelectionToClipboard(editor))}
            >
              <Copy aria-hidden className="size-3.5" />
              {copy.copy}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={locked || !editable || !capabilities.canMoveTo}
              onClick={() => {
                setMoveIds([...outlineViewState(editor.state).selected]);
                setMoveOpen(true);
              }}
            >
              <CornerDownRight aria-hidden className="size-3.5" />
              {copy.moveTo}
            </Button>
            <OutlineSelectionMoreMenu
              disabled={locked}
              available={{
                up: editable && capabilities.canMoveUp,
                down: editable && capabilities.canMoveDown,
                indent: editable && capabilities.canIndent,
                outdent: editable && capabilities.canOutdent,
                collapse: capabilities.canCollapse,
                expand: capabilities.canExpand,
                cut: editable && capabilities.canDelete,
                paste: editable,
                delete: editable && capabilities.canDelete,
              }}
              onAction={(action) => void run(action, moreCommands[action])}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ml-auto size-7"
              aria-label={copy.clear}
              title={copy.clear}
              disabled={locked}
              onClick={() => {
                setOutlineView(editor, { ...outlineViewState(editor.state), selected: [], anchor: null, active: null });
                setStatus(null);
                focusOutlineView(editor);
              }}
            >
              <X aria-hidden className="size-3.5" />
            </Button>
          </div>
        </>
      )}
      {status && (
        <p
          role={status.error ? 'alert' : 'status'}
          className={`px-1 pt-1 text-xs ${status.error ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {status.message}
        </p>
      )}
      {moveOpen && (
        <OutlineMoveDialog
          editor={editor}
          open={moveOpen}
          sourceIds={moveIds}
          onMoved={() => setStatus({ message: copy.moved, error: false })}
          onOpenChange={(open) => {
            setMoveOpen(open);
            if (!open && !editor.isDestroyed) {
              focusOutlineView(editor);
            }
          }}
        />
      )}
    </div>
  );
}
