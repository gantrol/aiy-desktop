import type { Editor } from '@tiptap/core';
import {
  DOMParser as ProseMirrorDOMParser,
  DOMSerializer,
  Fragment,
  type Node as ProseMirrorNode,
} from '@tiptap/pm/model';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import { copyLinkedBlockDocument } from '@/shared/block-anchor-copy';
import { blockDocumentSchema, type BlockNode } from '@/shared/contracts/block-document';
import { markdownBlockDocument } from '@/shared/block-document-codecs';
import { isOutlineChildList } from '@/shared/outline-structure';
import {
  outlineViewState,
  outlineVisibleItems,
  attachOutlineView,
  type OutlineViewState,
} from '@/renderer/features/content-editor/outlineViewState';
import { deleteOutlineSelection } from '@/renderer/features/content-editor/outlineEditing';
import { activeOutlineView } from '@/renderer/features/content-editor/outlineActiveView';

const outlineClipboardType = 'application/x-aiy-outline+json';
type OutlineClipboardEvent = Pick<ClipboardEvent, 'clipboardData' | 'preventDefault'>;

function clipboardPayload(editor: Editor) {
  const items = selectedRoots(editor);
  if (!items.length) return null;
  const document: BlockNode = {
    type: 'doc',
    content: [
      { type: 'bulletList', attrs: { blockId: crypto.randomUUID() }, content: items.map((item) => item.toJSON()) },
    ],
  };
  const copied = copyLinkedBlockDocument(document);
  const raw = JSON.stringify(copied);
  const wrapper = window.document.createElement('div');
  wrapper.dataset.aiyOutline = encodeURIComponent(raw);
  wrapper.append(
    DOMSerializer.fromSchema(editor.schema).serializeFragment(editor.schema.nodeFromJSON(copied.root).content),
  );
  return { raw, text: plainOutlineText(items), html: wrapper.outerHTML };
}

function itemById(doc: ProseMirrorNode, id: string): { node: ProseMirrorNode; position: number } | null {
  let found: { node: ProseMirrorNode; position: number } | null = null;
  doc.descendants((node, position) => {
    if (!found && node.type.name === 'listItem' && node.attrs.blockId === id) found = { node, position };
  });
  return found;
}

function selectedRoots(editor: Editor) {
  const view = outlineViewState(editor.state);
  const selected = new Set(view.selected);
  return outlineVisibleItems(editor.state.doc, { ...view, focus: null, folded: new Set() })
    .filter((row) => selected.has(row.id) && !row.ancestors.some((ancestor) => selected.has(ancestor)))
    .map((row) => itemById(editor.state.doc, row.id)?.node)
    .filter((item): item is ProseMirrorNode => Boolean(item));
}

function plainOutlineText(items: readonly ProseMirrorNode[]) {
  const lines: string[] = [];
  const visit = (item: ProseMirrorNode, depth: number) => {
    lines.push(`${'  '.repeat(depth)}${item.firstChild?.textContent ?? ''}`);
    item.forEach((child, _offset, index) => {
      if (!index) return;
      if (isOutlineChildList({ type: child.type.name, attrs: child.attrs })) {
        child.forEach((nested) => visit(nested, depth + 1));
      } else if (child.textContent) lines.push(`${'  '.repeat(depth + 1)}${child.textContent}`);
    });
  };
  items.forEach((item) => visit(item, 0));
  return lines.join('\n');
}

export function copyOutlineSelection(editor: Editor, event: OutlineClipboardEvent) {
  if (!outlineViewState(editor.state).selected.length || !event.clipboardData) return false;
  try {
    const payload = clipboardPayload(editor);
    if (!payload) return false;
    event.clipboardData.setData(outlineClipboardType, payload.raw);
    event.clipboardData.setData('text/plain', payload.text);
    event.clipboardData.setData('text/html', payload.html);
  } catch {
    return false;
  }
  event.preventDefault();
  return true;
}

/** HTML transports the same structural payload through the system clipboard. */
export async function copyOutlineSelectionToClipboard(editor: Editor): Promise<boolean> {
  if (editor.isDestroyed || !outlineViewState(editor.state).selected.length) return false;
  try {
    const payload = clipboardPayload(editor);
    if (!payload || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([payload.text], { type: 'text/plain' }),
        'text/html': new Blob([payload.html], { type: 'text/html' }),
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

function clipboardTargetUnchanged(editor: Editor, doc: ProseMirrorNode, previous: OutlineViewState) {
  if (editor.isDestroyed || activeOutlineView(editor).composing || !editor.isEditable || editor.state.doc !== doc)
    return false;
  const current = outlineViewState(editor.state);
  return (
    current.focus === previous.focus &&
    current.active === previous.active &&
    current.anchor === previous.anchor &&
    previous.selected.length === current.selected.length &&
    previous.selected.every((id, i) => current.selected[i] === id)
  );
}

export async function cutOutlineSelectionToClipboard(editor: Editor): Promise<boolean> {
  if (editor.isDestroyed || !editor.isEditable || activeOutlineView(editor).composing) return false;
  const { doc } = editor.state;
  const view = outlineViewState(editor.state);
  if (!view.selected.length || (view.focus && view.selected.includes(view.focus))) return false;
  if (!(await copyOutlineSelectionToClipboard(editor))) return false;
  // A delayed permission prompt must never cut a new selection or newly edited content.
  if (!clipboardTargetUnchanged(editor, doc, view)) return false;
  return deleteOutlineSelection(editor);
}

export async function pasteOutlineSelectionFromClipboard(editor: Editor): Promise<boolean> {
  if (editor.isDestroyed || !editor.isEditable || activeOutlineView(editor).composing) return false;
  const { doc, selection } = editor.state;
  const view = outlineViewState(editor.state);
  try {
    const data = new DataTransfer();
    if (navigator.clipboard?.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of ['text/html', 'text/plain', 'text/markdown']) {
          if (!item.types.includes(type)) continue;
          const blob = await item.getType(type);
          if (blob.size > 8_000_000) return false;
          data.setData(type, await blob.text());
        }
        if (data.types.length) break;
      }
    } else if (navigator.clipboard?.readText) {
      data.setData('text/plain', await navigator.clipboard.readText());
    } else return false;
    if (!clipboardTargetUnchanged(editor, doc, view) || !selection.eq(editor.state.selection)) return false;
    const event: OutlineClipboardEvent = { clipboardData: data, preventDefault() {} };
    if (pasteOutlineSelection(editor, event) || pasteExternalOutlineText(editor, event)) return true;
    return pasteOutlineTextContent(editor, event, data.getData('text/plain'), data.getData('text/html'));
  } catch {
    return false;
  }
}

function pastePosition(editor: Editor) {
  const view = outlineViewState(editor.state);
  const selectedId = view.active ?? view.selected.at(-1);
  if (selectedId) return itemById(editor.state.doc, selectedId);
  const resolved = editor.state.selection.$from;
  for (let depth = 1; depth <= resolved.depth; depth += 1) {
    if (resolved.node(depth).attrs.outlineRole === 'NOTE' || resolved.node(depth).type.name === 'taskList') return null;
  }
  for (let depth = resolved.depth; depth >= 1; depth -= 1) {
    const node = resolved.node(depth);
    if (node.type.name === 'listItem') return { node, position: resolved.before(depth) };
  }
  return null;
}

function insertOutlineItems(editor: Editor, event: OutlineClipboardEvent, nodes: readonly ProseMirrorNode[]) {
  const target = pastePosition(editor);
  if (!target || !nodes.length) return false;
  const previous = outlineViewState(editor.state);
  const transaction = closeHistory(editor.state.tr);
  let position = target.position + target.node.nodeSize;
  if (outlineViewState(editor.state).focus === target.node.attrs.blockId) {
    let groupPosition: number | null = null;
    target.node.forEach((child, offset) => {
      if (
        offset + child.nodeSize === target.node.content.size &&
        isOutlineChildList({ type: child.type.name, attrs: child.attrs })
      )
        groupPosition = target.position + 1 + offset;
    });
    if (groupPosition === null) {
      position = target.position + target.node.nodeSize - 1;
      transaction.insert(
        position,
        editor.schema.nodes.bulletList.create(
          { blockId: crypto.randomUUID(), outlineRole: 'CHILDREN' },
          Fragment.fromArray(nodes),
        ),
      );
      position += 1;
    } else {
      const group = editor.state.doc.nodeAt(groupPosition)!;
      position = groupPosition + group.nodeSize - 1;
      transaction.insert(position, Fragment.fromArray(nodes));
    }
  } else transaction.insert(position, Fragment.fromArray(nodes));
  const lastStart = position + nodes.slice(0, -1).reduce((sum, node) => sum + node.nodeSize, 0);
  transaction.setSelection(
    TextSelection.create(transaction.doc, lastStart + 2 + (nodes.at(-1)?.firstChild?.content.size ?? 0)),
  );
  const ids = nodes.map((node) => String(node.attrs.blockId));
  const folded = new Set(previous.folded);
  if (previous.focus && previous.focus === target.node.attrs.blockId) folded.delete(previous.focus);
  attachOutlineView(
    transaction,
    {
      ...previous,
      folded,
      selected: ids,
      anchor: ids[0],
      active: ids.at(-1)!,
    },
    previous,
  );
  editor.view.dispatch(transaction.scrollIntoView());
  event.preventDefault();
  return true;
}

export function pasteOutlineSelection(editor: Editor, event: OutlineClipboardEvent) {
  let raw = event.clipboardData?.getData(outlineClipboardType);
  if (!raw) {
    const html = event.clipboardData?.getData('text/html');
    if (html && html.length <= 8_000_000 && html.includes('data-aiy-outline')) {
      try {
        const value = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-aiy-outline]');
        raw = decodeURIComponent(value?.getAttribute('data-aiy-outline') ?? '');
      } catch {
        return false;
      }
    }
  }
  if (!raw || raw.length > 2_000_000 || !editor.isEditable || activeOutlineView(editor).composing) return false;
  let nodes: ProseMirrorNode[];
  try {
    const payload = blockDocumentSchema.parse(JSON.parse(raw));
    const source = payload.root.content?.[0];
    if (!source || !['bulletList', 'orderedList'].includes(source.type ?? '') || !source.content?.length) return false;
    const fresh = copyLinkedBlockDocument(payload.root).root.content![0].content!;
    nodes = fresh.map((node) => editor.schema.nodeFromJSON(node));
    if (nodes.some((node) => node.type.name !== 'listItem')) return false;
  } catch {
    return false;
  }
  return insertOutlineItems(editor, event, nodes);
}

function textParagraph(editor: Editor, text: string) {
  const lines = text.split(/\r?\n/u);
  const inline: ProseMirrorNode[] = [];
  lines.forEach((line, index) => {
    if (index) inline.push(editor.schema.nodes.hardBreak.create());
    if (line) inline.push(editor.schema.text(line));
  });
  return editor.schema.nodes.paragraph.create({ blockId: crypto.randomUUID() }, Fragment.fromArray(inline));
}

/** Plain text edits the active item; structured lists create items through the separate path. */
function pasteOutlineTextContent(editor: Editor, event: OutlineClipboardEvent, text: string, html = '') {
  if ((!text && !html) || text.length > 2_000_000 || html.length > 8_000_000) return false;
  const target = pastePosition(editor);
  if (!target) return false;
  const previous = outlineViewState(editor.state);
  const transaction = editor.state.tr;
  if (previous.selected.length) {
    transaction.setSelection(
      TextSelection.create(transaction.doc, target.position + 2 + (target.node.firstChild?.content.size ?? 0)),
    );
  } else {
    const { $from, $to } = transaction.selection;
    if ($from.parent !== target.node.firstChild || $to.parent !== $from.parent) return false;
  }
  if (html) {
    const dom = new DOMParser().parseFromString(html, 'text/html');
    const slice = ProseMirrorDOMParser.fromSchema(editor.schema).parseSlice(dom.body, {
      preserveWhitespace: true,
      context: transaction.selection.$from,
    });
    if (!slice.content.size) return false;
    transaction.replaceSelection(slice);
  } else
    transaction.replaceWith(transaction.selection.from, transaction.selection.to, textParagraph(editor, text).content);
  if (transaction.doc.eq(editor.state.doc)) return false;
  attachOutlineView(transaction, { ...previous, selected: [], anchor: null, active: null }, previous);
  editor.view.dispatch(transaction.scrollIntoView());
  event.preventDefault();
  return true;
}

function withOutlineChildren(editor: Editor, item: ProseMirrorNode, children: readonly ProseMirrorNode[]) {
  if (!children.length) return item;
  const group = editor.schema.nodes.bulletList.create(
    { blockId: crypto.randomUUID(), outlineRole: 'CHILDREN' },
    Fragment.fromArray([...children]),
  );
  return item.copy(item.content.append(Fragment.from(group)));
}

function indentedOutlineItems(editor: Editor, text: string): ProseMirrorNode[] | null {
  const lines = text.split(/\r?\n/u);
  if (lines.some((line) => !line.trim())) return null;
  const rows = lines.map((line) => {
    const indent = /^([ \t]*)/u.exec(line)?.[0] ?? '';
    return { width: [...indent].reduce((width, char) => width + (char === '\t' ? 2 : 1), 0), title: line.trim() };
  });
  const minimum = rows.reduce((value, row) => Math.min(value, row.width), Infinity);
  if (!rows.some((row) => row.width > minimum)) return null;
  interface Entry {
    width: number;
    title: string;
    children: Entry[];
  }
  const roots: Entry[] = [];
  const stack: Entry[] = [];
  for (const row of rows) {
    while (stack.length && row.width <= stack.at(-1)!.width) stack.pop();
    const entry: Entry = { ...row, children: [] };
    if (stack.length) stack.at(-1)!.children.push(entry);
    else roots.push(entry);
    stack.push(entry);
  }
  const build = (entry: Entry): ProseMirrorNode =>
    withOutlineChildren(
      editor,
      editor.schema.nodes.listItem.create({ blockId: crypto.randomUUID() }, textParagraph(editor, entry.title)),
      entry.children.map(build),
    );
  return roots.map(build);
}

function externalListItems(editor: Editor, text: string): ProseMirrorNode[] | null {
  const source = markdownBlockDocument(text).root.content ?? [];
  const convert = (block: BlockNode): ProseMirrorNode[] | null => {
    if (block.type === 'paragraph' || block.type === 'heading') {
      try {
        const paragraph = editor.schema.nodeFromJSON({
          ...block,
          type: 'paragraph',
          attrs: { blockId: crypto.randomUUID() },
        });
        return [editor.schema.nodes.listItem.create({ blockId: crypto.randomUUID() }, paragraph)];
      } catch {
        return null;
      }
    }
    if (block.type !== 'bulletList' && block.type !== 'orderedList') return null;
    const items: ProseMirrorNode[] = [];
    for (const item of block.content ?? []) {
      if (item.type !== 'listItem' || item.content?.[0]?.type !== 'paragraph') return null;
      const children: ProseMirrorNode[] = [];
      for (const [index, child] of (item.content ?? []).entries()) {
        if (child.type === 'paragraph') {
          try {
            children.push(editor.schema.nodeFromJSON({ ...child, attrs: { blockId: crypto.randomUUID() } }));
          } catch {
            return null;
          }
        } else if (index > 0 && (child.type === 'bulletList' || child.type === 'orderedList')) {
          const nested = convert(child);
          if (!nested) return null;
          children.push(
            editor.schema.nodes[child.type].create(
              { ...child.attrs, blockId: crypto.randomUUID(), outlineRole: 'CHILDREN' },
              Fragment.fromArray(nested),
            ),
          );
        } else return null;
      }
      try {
        items.push(editor.schema.nodes.listItem.create({ blockId: crypto.randomUUID() }, Fragment.fromArray(children)));
      } catch {
        return null;
      }
    }
    return items;
  };
  const items: ProseMirrorNode[] = [];
  const headingStack: { level: number; item: ProseMirrorNode; children: ProseMirrorNode[] }[] = [];
  const flushHeadings = (level: number) => {
    while (headingStack.length && headingStack.at(-1)!.level >= level) {
      const heading = headingStack.pop()!;
      const completed = withOutlineChildren(editor, heading.item, heading.children);
      if (headingStack.length) headingStack.at(-1)!.children.push(completed);
      else items.push(completed);
    }
  };
  for (const block of source) {
    const converted = convert(block);
    if (!converted) return null;
    if (block.type === 'heading') {
      const level = Number(block.attrs?.level) || 1;
      flushHeadings(level);
      headingStack.push({ level, item: converted[0], children: [] });
    } else if (headingStack.length) headingStack.at(-1)!.children.push(...converted);
    else items.push(...converted);
  }
  flushHeadings(0);
  return items.length ? items : null;
}

export function pasteExternalOutlineText(editor: Editor, event: OutlineClipboardEvent) {
  const clipboard = event.clipboardData;
  if (!clipboard || clipboard.files.length || !editor.isEditable || activeOutlineView(editor).composing) return false;
  const text = clipboard.getData('text/markdown') || clipboard.getData('text/plain');
  if (!text || text.length > 2_000_000) return false;
  const markdownList = /^\s*(?:[-+*]|\d+[.)])\s+/mu.test(text);
  const markdownHeading = /^\s*#{1,6}\s+/mu.test(text);
  const paragraphs = /\r?\n\s*\r?\n/u.test(text);
  if (clipboard.getData('text/html') && !clipboard.getData('text/markdown') && !markdownList && !markdownHeading)
    return outlineViewState(editor.state).selected.length
      ? pasteOutlineTextContent(editor, event, text, clipboard.getData('text/html'))
      : false;
  try {
    const indented = !markdownList && !markdownHeading && !paragraphs ? indentedOutlineItems(editor, text) : null;
    if (markdownList || markdownHeading || paragraphs || indented) {
      const nodes =
        markdownList || markdownHeading
          ? externalListItems(editor, text)
          : indented
            ? indented
            : text
                .trim()
                .split(/\r?\n\s*\r?\n/u)
                .map((part) =>
                  editor.schema.nodes.listItem.create({ blockId: crypto.randomUUID() }, textParagraph(editor, part)),
                );
      return nodes ? insertOutlineItems(editor, event, nodes) : false;
    }
  } catch {
    return false;
  }
  if (!/\r?\n/u.test(text) && !outlineViewState(editor.state).selected.length) return false;
  return pasteOutlineTextContent(editor, event, text);
}
