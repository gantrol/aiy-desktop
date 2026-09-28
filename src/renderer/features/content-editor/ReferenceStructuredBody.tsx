import { createElement, type ReactNode } from 'react';
import type { BlockDocument, BlockNode } from '@/shared/contracts/block-document';
import { contentAssetPath } from '@/shared/content-document';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { ContentMath } from '@/renderer/features/content-editor/ContentMath';
import { parseAiyDeepLink } from '@/shared/contracts/app-deep-link';

interface Options {
  occurrenceId: string;
  onLink(href: string): void;
  image(path: string, alt: string): ReactNode;
}

function safeLink(href: string) {
  return /^(https?:\/\/|#aiy-block:|aiy-figure:)/u.test(href) || parseAiyDeepLink(href) ? href : undefined;
}

function markedText(node: BlockNode, options: Options): ReactNode {
  let text: ReactNode = node.text ?? '';
  for (const [index, mark] of (node.marks ?? []).entries()) {
    const key = `mark-${index}`;
    if (mark.type === 'link') {
      const href = String(mark.attrs?.href ?? '');
      text = (
        <a
          key={key}
          href={safeLink(href)}
          className="underline underline-offset-2"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            options.onLink(href);
          }}
        >
          {text}
        </a>
      );
    } else {
      const tag = { bold: 'strong', italic: 'em', strike: 's', code: 'code', underline: 'u' }[mark.type];
      if (tag) text = createElement(tag, { key }, text);
    }
  }
  return text;
}

function renderBlock(node: BlockNode, key: string, options: Options): ReactNode {
  const children = node.content?.map((child, index) => renderBlock(child, `${key}-${index}`, options));
  const attrs = node.attrs ?? {};
  const props = { key, 'data-reference-source-block': typeof attrs.blockId === 'string' ? attrs.blockId : undefined };
  if (node.type && ['image', 'creatorTerm', 'creatorRecipe', 'linkCard'].includes(node.type))
    return renderResource(node, key, options);
  switch (node.type) {
    case 'inlineMath':
      return <ContentMath key={key} source={String(attrs.latex ?? '')} display={false} />;
    case 'blockMath':
      return (
        <div {...props}>
          <ContentMath source={String(attrs.latex ?? '')} display />
        </div>
      );
    case 'text':
      return <span key={key}>{markedText(node, options)}</span>;
    case 'hardBreak':
      return <br key={key} />;
    case 'heading':
      return createElement(
        `h${Math.max(1, Math.min(6, Number(attrs.level ?? 1)))}`,
        {
          ...props,
          'data-reference-heading': true,
          'data-article-heading-id': `reference-${options.occurrenceId}-${encodeURIComponent(String(attrs.blockId ?? key))}`,
        },
        children,
      );
    case 'paragraph':
      return <p {...props}>{children}</p>;
    case 'bulletList':
      return <ul {...props}>{children}</ul>;
    case 'orderedList':
      return (
        <ol {...props} start={Number(attrs.start ?? 1)}>
          {children}
        </ol>
      );
    case 'listItem':
      return <li {...props}>{children}</li>;
    case 'taskList':
      return (
        <ul {...props} data-type="taskList">
          {children}
        </ul>
      );
    case 'taskItem':
      return (
        <li {...props} data-type="taskItem" className="flex gap-2">
          <Checkbox disabled checked={attrs.checked === true} />
          <div>{children}</div>
        </li>
      );
    case 'blockquote':
      return <blockquote {...props}>{children}</blockquote>;
    case 'codeBlock':
      return (
        <pre {...props}>
          <code>{children}</code>
        </pre>
      );
    case 'horizontalRule':
      return <hr {...props} />;
    case 'table':
    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      return renderTable(node, key, children);
    default:
      return <div {...props}>{children}</div>;
  }
}

function renderTable(node: BlockNode, key: string, children: ReactNode): ReactNode {
  const attrs = node.attrs ?? {};
  const props = { key, 'data-reference-source-block': typeof attrs.blockId === 'string' ? attrs.blockId : undefined };
  if (node.type === 'table')
    return (
      <div {...props} className="tableWrapper max-w-full overflow-x-auto">
        <table>
          <tbody>{children}</tbody>
        </table>
      </div>
    );
  if (node.type === 'tableRow') return <tr {...props}>{children}</tr>;
  return createElement(
    node.type === 'tableCell' ? 'td' : 'th',
    {
      ...props,
      colSpan: Number(attrs.colspan ?? 1),
      rowSpan: Number(attrs.rowspan ?? 1),
    },
    children,
  );
}

/** Read-only content, not a second editor. Native text selection and scoped interactive media remain available. */
export function ReferenceStructuredBody({ document, ...options }: Options & { document: BlockDocument }) {
  return <>{document.root.content?.map((node, index) => renderBlock(node, String(index), options))}</>;
}

function renderResource(node: BlockNode, key: string, options: Options): ReactNode {
  const attrs = node.attrs ?? {};
  const props = { key, 'data-reference-source-block': typeof attrs.blockId === 'string' ? attrs.blockId : undefined };
  switch (node.type) {
    case 'image':
      return (
        <div {...props}>
          {options.image(
            String(attrs.assetId ? contentAssetPath(attrs.assetId) : (attrs.sourcePath ?? attrs.src ?? '')),
            String(attrs.alt ?? ''),
          )}
        </div>
      );
    case 'creatorTerm':
    case 'creatorRecipe':
      return <span {...props}>{String(attrs.promptText ?? '')}</span>;
    case 'linkCard':
      return (
        <p {...props}>
          <a
            href={safeLink(String(attrs.url ?? ''))}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              options.onLink(String(attrs.url ?? ''));
            }}
          >
            {String(attrs.title ?? attrs.url ?? '')}
          </a>
        </p>
      );
    default:
      return null;
  }
}
