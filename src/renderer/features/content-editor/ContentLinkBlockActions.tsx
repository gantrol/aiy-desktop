import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/renderer/components/ui/dropdown-menu';
import { useContentLinkProviders } from '@/renderer/features/content-editor/ContentLinkProviders';
import {
  applyContentLinkAction,
  contentLinkBlocks,
} from '@/renderer/features/content-editor/contentLinkPasteExtension';
import { convertLinkCard } from '@/renderer/features/content-editor/contentLinkCardExtension';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ContentSource } from '@/shared/contracts/content-library';

export function ContentLinkBlockActions({
  editor,
  blockId,
  source,
  standalone = false,
}: {
  editor: Editor;
  blockId: string;
  source?: ContentSource;
  standalone?: boolean;
}) {
  const copy = useI18n().messages.desktopPetals.editor;
  const providers = useContentLinkProviders();
  const block = useEditorState({
    editor,
    selector: ({ editor }) => {
      const block = contentLinkBlocks(editor.state.doc, [blockId])[0];
      return block
        ? { position: block.position, isCard: block.node.type.name === 'linkCard', attributes: block.attributes }
        : null;
    },
  });
  if (!block) return null;
  const provider = providers.find((item) => item.matches(block.attributes.url));
  const actions = (
    provider?.actions(source) ??
    (/^https?:\/\//iu.test(block.attributes.url) ? [{ id: 'card', label: copy.convertToLinkCard }] : [])
  ).filter(
    (action) =>
      !block.isCard ||
      JSON.stringify(action.application ?? null) !== JSON.stringify(block.attributes.application ?? null),
  );
  if (!block.isCard && !actions.length) return null;
  return (
    <>
      {!standalone && <DropdownMenuSeparator />}
      {block.isCard && (
        <DropdownMenuItem onSelect={() => convertLinkCard(editor, block.position, 'text')}>
          {copy.linkCardToText}
        </DropdownMenuItem>
      )}
      {actions.map((action) => (
        <DropdownMenuItem key={action.id} onSelect={() => applyContentLinkAction(editor, [blockId], action)}>
          {action.label}
        </DropdownMenuItem>
      ))}
    </>
  );
}
