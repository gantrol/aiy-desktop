import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useEffect, useMemo, useRef } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/renderer/components/ui/popover';
import { useContentLinkProviders } from '@/renderer/features/content-editor/ContentLinkProviders';
import {
  applyContentLinkAction,
  contentLinkBlocks,
  contentLinkPasteKey,
} from '@/renderer/features/content-editor/contentLinkPasteExtension';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ContentSource } from '@/shared/contracts/content-library';

export function ContentLinkPasteMenu({ editor, source }: { editor: Editor; source?: ContentSource }) {
  const copy = useI18n().messages.desktopPetals.editor;
  const providers = useContentLinkProviders();
  const firstAction = useRef<HTMLButtonElement>(null);
  const pending = useEditorState({
    editor,
    selector: ({ editor }) => contentLinkPasteKey.getState(editor.state) ?? null,
  });
  const provider = providers.find((item) => item.id === pending?.providerId);
  const anchor = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => {
          if (editor.isDestroyed || !pending) return new DOMRect();
          const blocks = contentLinkBlocks(
            editor.state.doc,
            pending.links.map((link) => link.blockId),
          );
          if (!blocks.length) return new DOMRect();
          const last = blocks[blocks.length - 1];
          const position = editor.view.coordsAtPos(last.position + last.node.nodeSize - 1);
          return new DOMRect(position.left, position.top, 1, position.bottom - position.top);
        },
      },
    }),
    [editor, pending],
  );
  useEffect(() => {
    let root: HTMLElement | null = null;
    const focus = () => firstAction.current?.focus();
    const detach = () => {
      root?.removeEventListener('content-link-paste-focus', focus);
      root = null;
    };
    const attach = () => {
      detach();
      // The editor can lose its view between rendering and running this effect.
      if (editor.isDestroyed) return;
      root = editor.view.dom;
      root.addEventListener('content-link-paste-focus', focus);
    };
    editor.on('mount', attach);
    editor.on('unmount', detach);
    attach();
    return () => {
      editor.off('mount', attach);
      editor.off('unmount', detach);
      detach();
    };
  }, [editor]);
  if (editor.isDestroyed || !pending || (pending.providerId !== null && !provider) || !editor.isEditable) return null;
  const actions = provider?.actions(source) ?? [{ id: 'card', label: copy.convertToLinkCard }];
  const dismiss = () => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(contentLinkPasteKey, null));
  };
  const focusEditor = () => {
    if (!editor.isDestroyed) editor.view.focus();
  };
  return (
    <Popover open onOpenChange={(open) => !open && dismiss()}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        align="start"
        side="bottom"
        className="w-auto max-w-[calc(100vw-24px)] min-w-40 rounded-sm p-1 shadow-none"
        aria-label={copy.pastedLinkActions}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={focusEditor}
      >
        <Button
          ref={firstAction}
          variant="ghost"
          size="sm"
          className="w-full justify-start rounded-sm"
          onClick={() => {
            dismiss();
            focusEditor();
          }}
        >
          {copy.keepLink}
        </Button>
        {actions.map((action) => (
          <Button
            key={action.id}
            variant="ghost"
            size="sm"
            className="flex w-full justify-start rounded-sm"
            onClick={() =>
              applyContentLinkAction(
                editor,
                pending.links.map((link) => link.blockId),
                action,
              )
            }
          >
            {action.label}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
