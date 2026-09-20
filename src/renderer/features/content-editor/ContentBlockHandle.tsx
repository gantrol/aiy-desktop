import { ContentBlockActions } from '@/renderer/features/content-editor/ContentBlockActions';
import { contentRootBlock } from '@/renderer/features/content-editor/contentRootBlock';
import type { Editor } from '@tiptap/core';
import type { ContentSource } from '@/shared/contracts/content-library';
import { useEffect, useRef, useState, type RefObject } from 'react';

/** One handle for the hovered root block; nested lists/tables retain their existing internal tools. */
export function ContentBlockHandle({
  editor,
  rootRef,
  source,
  outlineMode,
}: {
  editor: Editor;
  rootRef: RefObject<HTMLDivElement | null>;
  source?: ContentSource;
  outlineMode?: boolean;
}) {
  const [target, setTarget] = useState<{ id: string; top: number } | null>(null);
  const menuOpen = useRef(false);
  const targetId = useRef<string | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || editor.isDestroyed) return;
    let frame: number | null = null;
    const show = (id?: string) => {
      if (editor.isDestroyed || !editor.isEditable || editor.view.composing) return;
      const block = contentRootBlock(editor, id);
      const dom = block && editor.view.nodeDOM(block.position);
      if (
        !block ||
        !(dom instanceof HTMLElement) ||
        !block.node.attrs.blockId ||
        (outlineMode && ['bulletList', 'orderedList', 'taskList'].includes(block.node.type.name))
      ) {
        menuOpen.current = false;
        targetId.current = null;
        setTarget(null);
        return;
      }
      targetId.current = String(block.node.attrs.blockId);
      const next = { id: targetId.current, top: dom.getBoundingClientRect().top - root.getBoundingClientRect().top };
      setTarget((previous) => (previous?.id === next.id && previous.top === next.top ? previous : next));
    };
    const move = (event: PointerEvent) => {
      if (menuOpen.current || event.buttons || editor.view.composing) return;
      const rect = editor.view.dom.getBoundingClientRect();
      if (event.clientY < rect.top || event.clientY > rect.bottom) return;
      const hit = editor.view.posAtCoords({
        left: Math.max(rect.left + 1, Math.min(rect.right - 1, event.clientX)),
        top: event.clientY,
      });
      if (!hit) return;
      const index = editor.state.doc.resolve(hit.pos).index(0);
      const node = editor.state.doc.maybeChild(index);
      if (node?.attrs.blockId && node.attrs.blockId !== targetId.current) show(String(node.attrs.blockId));
    };
    const leave = () => {
      if (menuOpen.current) return;
      targetId.current = null;
      setTarget(null);
    };
    const selected = () => {
      if (!menuOpen.current) show();
    };
    const changed = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        if (targetId.current) show(targetId.current);
      });
    };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerleave', leave);
    editor.on('selectionUpdate', selected);
    editor.on('transaction', changed);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerleave', leave);
      editor.off('selectionUpdate', selected);
      editor.off('transaction', changed);
    };
  }, [editor, rootRef, outlineMode]);
  if (!target || !editor.isEditable) return null;
  return (
    <div className="absolute left-0 z-20" style={{ top: target.top }}>
      <ContentBlockActions
        editor={editor}
        blockId={target.id}
        source={source}
        onOpenChange={(open) => {
          menuOpen.current = open;
        }}
      />
    </div>
  );
}
