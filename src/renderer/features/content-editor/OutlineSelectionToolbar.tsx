import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  Copy,
  CornerDownRight,
  IndentDecrease,
  IndentIncrease,
  Scissors,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from 'react';
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

const toolbarCopy = {
  zh: {
    title: '大纲批量操作',
    selection: (count: number, roots: number) => `已选 ${count} 项 · 将操作 ${roots} 个分支`,
    up: '上移',
    down: '下移',
    indent: '缩进',
    outdent: '反缩进',
    collapse: '收起',
    expand: '展开',
    copy: '复制',
    cut: '剪切',
    paste: '粘贴',
    moveTo: '移动到',
    delete: '删除',
    clear: '取消选择',
    unavailable: '当前选择不能执行这项操作；请检查范围或移动目标。',
    clipboardUnavailable: '剪贴板不可用，或编辑位置已改变。请重新选择，或使用 Ctrl/Cmd+C、X、V 重试。',
    done: (action: string, count: number) => `已${action} ${count} 个分支`,
    pasted: '已粘贴大纲内容',
    moved: '已移动所选分支',
    deleted: '已删除所选分支，可撤销恢复',
  },
  en: {
    title: 'Outline selection actions',
    selection: (count: number, roots: number) => `${count} items selected · ${roots} branches to act on`,
    up: 'Move up',
    down: 'Move down',
    indent: 'Indent',
    outdent: 'Outdent',
    collapse: 'Collapse',
    expand: 'Expand',
    copy: 'Copy',
    cut: 'Cut',
    paste: 'Paste',
    moveTo: 'Move to',
    delete: 'Delete',
    clear: 'Clear selection',
    unavailable: 'This action is unavailable for the current selection. Check the range or destination.',
    clipboardUnavailable:
      'The clipboard is unavailable or the editing position changed. Select again, or retry with Ctrl/Cmd+C, X or V.',
    done: (action: string, count: number) => `${action}: ${count} branches`,
    pasted: 'Outline content pasted',
    moved: 'Selected branches moved',
    deleted: 'Selected branches deleted. Undo to restore them.',
  },
};

export function OutlineSelectionToolbar({ editor }: { editor: Editor }) {
  const { locale } = useI18n();
  const copy = toolbarCopy[locale === 'zh' ? 'zh' : 'en'];
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
  const locked = busy !== null || moveOpen || activeOutlineView(editor).composing;
  const button = (
    action: Action,
    Icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>,
    available: boolean,
    command: () => boolean | Promise<boolean>,
  ) => (
    <Button
      key={action}
      type="button"
      variant="ghost"
      size="xs"
      aria-label={copy[action]}
      title={copy[action]}
      className={action === 'delete' ? 'text-destructive hover:text-destructive' : undefined}
      disabled={locked || !available}
      onClick={() => void run(action, command)}
    >
      <Icon aria-hidden className="size-3.5" />
      {copy[action]}
    </Button>
  );

  return (
    <div
      data-outline-selection-toolbar
      className="sticky bottom-2 z-30 mx-2 mt-3 rounded-md border bg-surface p-2 shadow-overlay"
    >
      {selected.length > 0 && (
        <>
          <p className="px-1 pb-1 text-xs font-medium" aria-live="polite" aria-atomic="true">
            {copy.selection(capabilities.selectedCount, capabilities.branchCount)}
          </p>
          <div
            role="toolbar"
            aria-label={copy.title}
            aria-busy={busy !== null}
            className="flex flex-wrap items-center gap-1"
            onMouseDown={(event) => event.preventDefault()}
          >
            {button('up', ArrowUp, editable && capabilities.canMoveUp, () => moveSelectedOutlineItemsByOne(editor, -1))}
            {button('down', ArrowDown, editable && capabilities.canMoveDown, () =>
              moveSelectedOutlineItemsByOne(editor, 1),
            )}
            {button('indent', IndentIncrease, editable && capabilities.canIndent, () =>
              shiftSelectedOutlineItems(editor, false),
            )}
            {button('outdent', IndentDecrease, editable && capabilities.canOutdent, () =>
              shiftSelectedOutlineItems(editor, true),
            )}
            <span role="separator" aria-orientation="vertical" className="mx-1 h-5 border-l" />
            {button('collapse', ChevronRight, capabilities.canCollapse, () =>
              setSelectedOutlineItemsFolded(editor, true),
            )}
            {button('expand', ChevronDown, capabilities.canExpand, () => setSelectedOutlineItemsFolded(editor, false))}
            <span role="separator" aria-orientation="vertical" className="mx-1 h-5 border-l" />
            {button('copy', Copy, capabilities.branchCount > 0, () => copyOutlineSelectionToClipboard(editor))}
            {button('cut', Scissors, editable && capabilities.canDelete, () => cutOutlineSelectionToClipboard(editor))}
            {button('paste', ClipboardPaste, editable, () => pasteOutlineSelectionFromClipboard(editor))}
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
            <span role="separator" aria-orientation="vertical" className="mx-1 h-5 border-l" />
            {button('delete', Trash2, editable && capabilities.canDelete, () => deleteOutlineSelection(editor))}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={locked}
              onClick={() => {
                setOutlineView(editor, { ...outlineViewState(editor.state), selected: [], anchor: null });
                setStatus(null);
                focusOutlineView(editor);
              }}
            >
              <X aria-hidden className="size-3.5" />
              {copy.clear}
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
