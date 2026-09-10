import type { Editor } from '@tiptap/core';
import { useState, type ReactNode } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/renderer/components/ui/dropdown-menu';
import { ContentLinkBlockActions } from '@/renderer/features/content-editor/ContentLinkBlockActions';
import { useContentLinkProviders } from '@/renderer/features/content-editor/ContentLinkProviders';
import { contentLinkBlocks } from '@/renderer/features/content-editor/contentLinkPasteExtension';
import type { ContentSource } from '@/shared/contracts/content-library';

export function ContentLinkContextMenu({
  editor,
  source,
  children,
}: {
  editor: Editor;
  source?: ContentSource;
  children: ReactNode;
}) {
  const [menu, setMenu] = useState<{ blockId: string; x: number; y: number } | null>(null);
  const providers = useContentLinkProviders();
  return (
    <DropdownMenu open={Boolean(menu)} onOpenChange={(open) => !open && setMenu(null)}>
      <DropdownMenuTrigger
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none fixed h-0 w-0"
        style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
      />
      <div
        className="min-w-0 overflow-hidden"
        onContextMenu={(event) => {
          if (event.defaultPrevented || editor.isDestroyed || !editor.isEditable || editor.view.composing) return;
          const target = event.target instanceof Element ? event.target.closest('a[href], [data-aiy-link-card]') : null;
          if (!target || !editor.view.dom.contains(target)) return;
          let root = target;
          while (root.parentElement && root.parentElement !== editor.view.dom) root = root.parentElement;
          const offset = Array.from(editor.view.dom.childNodes).indexOf(root);
          if (offset < 0) return;
          const position = editor.view.posAtDOM(editor.view.dom, offset);
          const node = editor.state.doc.nodeAt(position);
          const id = node?.attrs.blockId;
          const block = typeof id === 'string' ? contentLinkBlocks(editor.state.doc, [id])[0] : null;
          const provider = block && providers.find((item) => item.matches(block.attributes.url));
          if (
            !block ||
            (block.node.type.name !== 'linkCard' &&
              !(provider ? provider.actions(source).length : /^https?:\/\//iu.test(block.attributes.url)))
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          setMenu({ blockId: id, x: event.clientX, y: event.clientY });
        }}
      >
        {children}
      </div>
      {menu && (
        <DropdownMenuContent
          align="start"
          className="rounded-sm shadow-none"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!editor.isDestroyed) editor.view.focus();
          }}
        >
          <ContentLinkBlockActions editor={editor} blockId={menu.blockId} source={source} standalone />
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}
