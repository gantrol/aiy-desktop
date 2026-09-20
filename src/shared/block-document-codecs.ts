import { contentAssetPath } from '@/shared/content-document';
import { contentMarkdownTree } from '@/shared/content-markdown';
import { captureBlockDocument, type BlockDocument, type BlockNode } from '@/shared/contracts/block-document';
import { Node } from '@tiptap/core';
import { TableKit } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import { MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { linkCardMarkdown } from '@/shared/link-card-document';
import type { List, PhrasingContent, RootContent } from 'mdast';

const image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  renderMarkdown: (node) => {
    const path = String(
      node.attrs?.sourcePath ||
        (node.attrs?.assetId ? contentAssetPath(String(node.attrs.assetId)) : node.attrs?.src || ''),
    );
    const alt = String(node.attrs?.alt || '').replace(/[\[\]\\]/gu, '\\$&');
    const title = node.attrs?.title ? ' "' + String(node.attrs.title).replace(/[\\"]/gu, '\\$&') + '"' : '';
    return `![${alt}](<${path.replace(/>/gu, '%3E')}>${title})`;
  },
});
const reference = Node.create({
  name: 'contentReference',
  group: 'block',
  atom: true,
  renderMarkdown: (node) => `:::aiy-block ${String(node.attrs?.referenceId ?? '')}\n:::`,
});
const inlineNodes = ['creatorTerm', 'creatorRecipe'].map((name) =>
  Node.create({
    name,
    group: 'inline',
    inline: true,
    atom: true,
    renderMarkdown: (node) => String(node.attrs?.promptText ?? ''),
  }),
);
const markdown = new MarkdownManager({
  extensions: [
    StarterKit,
    TableKit,
    TaskList,
    TaskItem,
    image,
    reference,
    ...inlineNodes,
    Node.create({ name: 'linkCard', group: 'block', atom: true, renderMarkdown: linkCardMarkdown }),
  ],
});

const projections = new WeakMap<BlockNode, { signature: string; markdown: string }>();

/** Export is a projection. Persisted JSON is never reconstructed from this result. */
export function blockDocumentMarkdown(
  document: BlockDocument,
  media: readonly { path: string; assetId: string }[] = [],
): string {
  const signature = JSON.stringify(media.map((binding) => [binding.path, binding.assetId]));
  const previous = projections.get(document.root);
  if (previous?.signature === signature) return previous.markdown;
  const hasInteraction = (node: BlockNode): boolean =>
    node.type === 'details' || node.type === 'reveal' || Boolean(node.content?.some(hasInteraction));
  if (!media.length && !hasInteraction(document.root)) {
    const result = markdown.serialize(document.root);
    projections.set(document.root, { signature, markdown: result });
    return result;
  }
  const paths = new Map(media.map((binding) => [binding.assetId, binding.path]));
  const project = (node: BlockNode): BlockNode[] => {
    if (node.type === 'details') {
      const [summary, body] = node.content ?? [];
      const heading: BlockNode[] = summary?.content?.length
        ? [
            {
              type: 'paragraph',
              content: summary.content.map((child) => ({
                ...child,
                marks: child.marks?.some((mark) => mark.type === 'bold')
                  ? child.marks
                  : [...(child.marks ?? []), { type: 'bold' }],
              })),
            },
          ]
        : [];
      return [...heading, ...(body?.content ?? []).flatMap(project)];
    }
    if (node.type === 'reveal') return (node.content ?? []).flatMap((stage) => (stage.content ?? []).flatMap(project));
    return [
      {
        ...node,
        ...(node.type === 'image' && paths.has(node.attrs?.assetId)
          ? {
              attrs: {
                ...node.attrs,
                sourcePath:
                  media.find(
                    (binding) => binding.assetId === node.attrs?.assetId && binding.path === node.attrs?.mediaPath,
                  )?.path ?? paths.get(node.attrs?.assetId),
              },
            }
          : {}),
        ...(node.content ? { content: node.content.flatMap(project) } : {}),
      },
    ];
  };
  const result = markdown.serialize(project(document.root)[0]!);
  projections.set(document.root, { signature, markdown: result });
  return result;
}

export function plainTextBlockDocument(text: string): BlockDocument {
  return captureBlockDocument({
    type: 'doc',
    content: text
      .replace(/\r\n?/gu, '\n')
      .split('\n\n')
      .map((paragraph) => ({
        type: 'paragraph',
        content: paragraph
          .split('\n')
          .flatMap((line, index): BlockNode[] => [
            ...(index ? [{ type: 'hardBreak' }] : []),
            ...(line ? [{ type: 'text', text: line }] : []),
          ]),
      })),
  });
}

function markdownListBlocks(node: List, visit: (node: RootContent) => BlockNode[]): BlockNode[] {
  const lists: BlockNode[] = [];
  for (const [index, item] of node.children.entries()) {
    // GFM permits mixed items; the document schema requires homogeneous list containers.
    const task = item.checked != null;
    const type = task ? 'taskList' : node.ordered ? 'orderedList' : 'bulletList';
    let list = lists.at(-1);
    if (!list || list.type !== type) {
      list = {
        type,
        ...(type === 'orderedList' ? { attrs: { start: (node.start ?? 1) + index } } : {}),
        content: [],
      };
      lists.push(list);
    }
    list.content!.push({
      type: task ? 'taskItem' : 'listItem',
      ...(task ? { attrs: { checked: item.checked === true } } : {}),
      content: item.children.flatMap(visit),
    });
  }
  return lists;
}

/** Legacy Markdown is imported once, without a browser DOM or execution of embedded HTML. */
export function markdownBlockDocument(
  text: string,
  media: readonly { path: string; assetId: string }[] = [],
): BlockDocument {
  const tree = contentMarkdownTree(text);
  const definitions = new Map(
    tree.children.flatMap((node) =>
      node.type === 'definition' ? [[node.identifier.toLowerCase(), node] as const] : [],
    ),
  );
  const leaf = (node: RootContent | PhrasingContent): BlockNode[] | null => {
    switch (node.type) {
      case 'text':
        return node.value ? [{ type: 'text', text: node.value }] : [];
      case 'break':
        return [{ type: 'hardBreak' }];
      case 'inlineCode':
        return node.value ? [{ type: 'text', text: node.value, marks: [{ type: 'code' }] }] : [];
      case 'image':
        return [
          {
            type: 'image',
            attrs: { src: node.url, sourcePath: node.url, alt: node.alt ?? '', title: node.title ?? null },
          },
        ];
      case 'imageReference': {
        const definition = definitions.get(node.identifier.toLowerCase());
        return [
          {
            type: 'image',
            attrs: {
              src: definition?.url ?? '',
              sourcePath: definition?.url ?? '',
              alt: node.alt ?? '',
              title: definition?.title ?? null,
            },
          },
        ];
      }
      case 'code':
        return [
          {
            type: 'codeBlock',
            attrs: { language: node.lang ?? null },
            content: node.value ? [{ type: 'text', text: node.value }] : [],
          },
        ];
      case 'thematicBreak':
        return [{ type: 'horizontalRule' }];
      case 'html':
        return node.value ? [{ type: 'text', text: node.value }] : [];
      case 'definition':
        return [];
      default:
        return null;
    }
  };
  const visit = (node: RootContent | PhrasingContent): BlockNode[] => {
    const children = () =>
      'children' in node ? node.children.flatMap((child) => visit(child as RootContent | PhrasingContent)) : [];
    const marked = (type: string, attrs?: Record<string, unknown>) =>
      children().map((child) => ({ ...child, marks: [...(child.marks ?? []), { type, ...(attrs ? { attrs } : {}) }] }));
    const decoded = leaf(node);
    if (decoded) return decoded;
    switch (node.type) {
      case 'paragraph': {
        const raw = text.slice(node.position?.start.offset, node.position?.end.offset);
        const ref = /^:::aiy-block ([A-Za-z0-9_-]{1,200})\r?\n:::[ \t]*$/u.exec(raw);
        return ref
          ? [{ type: 'contentReference', attrs: { referenceId: ref[1] } }]
          : [{ type: 'paragraph', content: children() }];
      }
      case 'heading':
        return [{ type: 'heading', attrs: { level: node.depth }, content: children() }];
      case 'strong':
        return marked('bold');
      case 'emphasis':
        return marked('italic');
      case 'delete':
        return marked('strike');
      case 'link':
        return marked('link', { href: node.url, title: node.title ?? null });
      case 'linkReference': {
        const definition = definitions.get(node.identifier.toLowerCase());
        return definition ? marked('link', { href: definition.url, title: definition.title ?? null }) : children();
      }
      case 'blockquote':
        return [{ type: 'blockquote', content: children() }];
      case 'list':
        return markdownListBlocks(node, visit);
      case 'table':
        return [
          {
            type: 'table',
            content: node.children.map((row, index) => ({
              type: 'tableRow',
              content: row.children.map((cell) => ({
                type: index ? 'tableCell' : 'tableHeader',
                content: [{ type: 'paragraph', content: cell.children.flatMap(visit) }],
              })),
            })),
          },
        ];
      default:
        return children();
    }
  };
  // Markdown allows images and HTML among paragraph text. The editor's image nodes are blocks.
  const normalize = (node: BlockNode): BlockNode[] => {
    const content = node.content?.flatMap(normalize);
    if (node.type === 'listItem' || node.type === 'taskItem') {
      return [
        {
          ...node,
          content: content?.[0]?.type === 'paragraph' ? content : [{ type: 'paragraph' }, ...(content ?? [])],
        },
      ];
    }
    if (node.type !== 'paragraph' || !content?.some((child) => child.type === 'image'))
      return [{ ...node, ...(content ? { content } : {}) }];
    const result: BlockNode[] = [];
    let inline: BlockNode[] = [];
    for (const child of content) {
      if (child.type === 'image') {
        if (inline.length) result.push({ type: 'paragraph', content: inline });
        result.push(child);
        inline = [];
      } else inline.push(child);
    }
    if (inline.length) result.push({ type: 'paragraph', content: inline });
    return result;
  };
  const content = tree.children
    .flatMap(visit)
    .flatMap(normalize)
    .map((node) => (node.type === 'text' ? { type: 'paragraph', content: [node] } : node));
  return captureBlockDocument({ type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }, media);
}

export function blockDocumentText(document: BlockDocument): string {
  const visit = (node: BlockNode): string => {
    if (node.type === 'text') return node.text ?? '';
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'image') return String(node.attrs?.alt ?? '');
    if (node.type === 'linkCard') return [node.attrs?.title, node.attrs?.url].filter(Boolean).join('\n');
    if (node.type === 'creatorTerm' || node.type === 'creatorRecipe') return String(node.attrs?.promptText ?? '');
    return (node.content ?? [])
      .map(visit)
      .join(
        [
          'doc',
          'blockquote',
          'bulletList',
          'orderedList',
          'taskList',
          'listItem',
          'taskItem',
          'table',
          'tableRow',
          'tableCell',
          'tableHeader',
          'details',
          'detailsContent',
          'reveal',
          'revealInitial',
          'revealAnswer',
        ].includes(node.type ?? '')
          ? '\n\n'
          : '',
      );
  };
  return visit(document.root);
}
