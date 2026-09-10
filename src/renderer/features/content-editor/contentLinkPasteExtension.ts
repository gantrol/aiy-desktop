import { Extension, type Editor } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ContentLinkAction, ContentLinkProvider } from '@/renderer/features/content-editor/ContentLinkProviders';
import { pastedWebLinks } from '@/renderer/features/content-editor/contentLinkPasteTargets';
import { linkCardAttributesSchema, type LinkCardAttributes } from '@/shared/contracts/link-card';
import { paragraphLinkCard } from '@/shared/link-card-document';

export interface PastedContentLinks {
  providerId: string | null;
  links: (LinkCardAttributes & { blockId: string })[];
}
export const contentLinkPasteKey = new PluginKey<PastedContentLinks | null>('contentLinkPaste');

export function contentLinkBlocks(doc: ProseMirrorNode, ids: readonly string[]) {
  const wanted = new Set(ids);
  const blocks: { node: ProseMirrorNode; position: number; attributes: LinkCardAttributes }[] = [];
  doc.forEach((node, position) => {
    if (!wanted.has(node.attrs.blockId)) return;
    const candidate = node.type.name === 'linkCard' ? node.toJSON() : paragraphLinkCard(node.toJSON());
    const parsed = linkCardAttributesSchema.safeParse(candidate?.attrs);
    if (parsed.success) blocks.push({ node, position, attributes: parsed.data });
  });
  return blocks.length === wanted.size ? blocks : [];
}

export function applyContentLinkAction(editor: Editor, ids: readonly string[], action: ContentLinkAction) {
  if (editor.isDestroyed || !editor.isEditable || editor.view.composing) return false;
  const blocks = contentLinkBlocks(editor.state.doc, ids);
  if (!blocks.length) return false;
  const transaction = closeHistory(editor.state.tr);
  for (const { node, position, attributes } of [...blocks].reverse()) {
    transaction.replaceWith(
      position,
      position + node.nodeSize,
      editor.schema.nodes.linkCard.create({
        ...attributes,
        blockId: node.attrs.blockId,
        application: action.application ?? null,
      }),
    );
  }
  transaction.setMeta(contentLinkPasteKey, null);
  transaction.setSelection(NodeSelection.create(transaction.doc, blocks[0].position));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
  return true;
}

export function createContentLinkPasteExtension(providers: () => readonly ContentLinkProvider[]) {
  return Extension.create({
    name: 'contentLinkPaste',
    priority: 120,
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin<PastedContentLinks | null>({
          key: contentLinkPasteKey,
          state: {
            init: () => null,
            apply(transaction, previous) {
              const meta = transaction.getMeta(contentLinkPasteKey) as PastedContentLinks | null | undefined;
              if (meta !== undefined) return meta;
              if (!previous) return null;
              const blocks = contentLinkBlocks(
                transaction.doc,
                previous.links.map((link) => link.blockId),
              );
              if (
                !blocks.length ||
                blocks.some(
                  (block, index) =>
                    block.node.type.name !== 'paragraph' ||
                    block.attributes.url !== previous.links[index].url ||
                    block.node.textContent !== (previous.links[index].title || previous.links[index].url),
                )
              )
                return null;
              if (transaction.selectionSet) {
                const last = blocks[blocks.length - 1];
                if (
                  !transaction.selection.empty ||
                  transaction.selection.from !== last.position + last.node.nodeSize - 1
                )
                  return null;
              }
              return previous;
            },
          },
          props: {
            handleKeyDown(view, event) {
              const pending = contentLinkPasteKey.getState(view.state);
              if (
                !pending ||
                view.composing ||
                (pending.providerId !== null && !providers().some((provider) => provider.id === pending.providerId))
              )
                return false;
              if (event.key === 'Escape') {
                view.dispatch(view.state.tr.setMeta(contentLinkPasteKey, null));
                return true;
              }
              if (event.key === 'ArrowDown') {
                view.dom.dispatchEvent(new Event('content-link-paste-focus'));
                return true;
              }
              return false;
            },
            handlePaste(view, event, slice) {
              if (!editor.isEditable || view.composing || !event.clipboardData || event.clipboardData.files.length)
                return false;
              // Copied card nodes already carry an explicit presentation and any application relationship.
              if (slice.content.content.some((node) => node.type.name === 'linkCard')) return false;
              const { selection } = view.state;
              const { $from, $to } = selection;
              const afterCard =
                $from.depth === 0 && selection instanceof NodeSelection && selection.node.type.name === 'linkCard';
              if (!afterCard && ($from.depth !== 1 || !$from.sameParent($to) || $from.parent.type.name !== 'paragraph'))
                return false;
              if (
                !afterCard &&
                $from.parent.content.size &&
                ($from.parentOffset !== 0 || $to.parentOffset !== $from.parent.content.size)
              )
                return false;
              const text = event.clipboardData.getData('text/plain');
              let providerId: string | null = null;
              let attributes: LinkCardAttributes[] | null = null;
              for (const provider of providers()) {
                const candidates = provider.parsePaste(text);
                if (!candidates?.length || candidates.length > 100) continue;
                const parsed = linkCardAttributesSchema.array().safeParse(candidates);
                if (!parsed.success) continue;
                providerId = provider.id;
                attributes = parsed.data;
                break;
              }
              attributes ??= pastedWebLinks(text, slice);
              if (!attributes?.length) return false;
              const links = attributes.map((link, index) => ({
                ...link,
                blockId:
                  !afterCard && index === 0 && $from.parent.attrs.blockId
                    ? String($from.parent.attrs.blockId)
                    : crypto.randomUUID(),
              }));
              const paragraphs = links.map((link) =>
                editor.schema.nodes.paragraph.create(
                  { blockId: link.blockId, linkCardDisabled: true },
                  editor.schema.text(link.title || link.url, [editor.schema.marks.link.create({ href: link.url })]),
                ),
              );
              const position = afterCard ? selection.to : $from.before(1);
              const transaction = view.state.tr.replaceWith(
                position,
                afterCard ? position : $from.after(1),
                paragraphs,
              );
              const end = position + paragraphs.reduce((size, node) => size + node.nodeSize, 0) - 1;
              transaction.setSelection(TextSelection.create(transaction.doc, end));
              transaction.setMeta(contentLinkPasteKey, { providerId, links } satisfies PastedContentLinks);
              event.preventDefault();
              view.dispatch(transaction.scrollIntoView());
              return true;
            },
          },
        }),
      ];
    },
  });
}
