import { isValidElement, memo, useMemo, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { ContentMarkdown } from '@/renderer/features/content-editor/ContentMarkdown';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { CodexHistoryMath } from '@/renderer/features/extensions/CodexHistoryMath';
import { CodexHistoryMermaid } from '@/renderer/features/extensions/CodexHistoryMermaid';
import { historyHighlightClassName } from '@/renderer/features/extensions/CodexHistoryHighlightedText';
import { codexHistoryMarkdownHighlights } from '@/renderer/features/extensions/codexHistoryMarkdownHighlights';
import { codexHistoryMarkdownMath } from '@/renderer/features/extensions/codexHistoryMarkdownMath';
import { useI18n } from '@/renderer/i18n/useI18n';
import { codexMarkdownUrlTransform } from '@/renderer/lib/codexThreadLinks';
import { parseCodexThreadHref } from '@/shared/contracts/codex-thread';

function historyMarkdownUrlTransform(value: string) {
  return value.startsWith('aiy-media://codex-history/') ? value : codexMarkdownUrlTransform(value);
}

function replaceRichSyntaxText(value: string) {
  return value
    .replace(
      /<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/giu,
      (_whole, summary: string, body: string) =>
        `> **${summary.replace(/<[^>]+>/gu, '').trim()}**\n>\n${body
          .trim()
          .split(/\r?\n/u)
          .map((line) => `> ${line}`)
          .join('\n')}`,
    )
    .replace(/\\\[([\s\S]*?)\\\]/gu, (_whole, formula: string) => `$$${formula}$$`)
    .replace(/\\\(([^\n]*?)\\\)/gu, (_whole, formula: string) => `$${formula}$`);
}

function replaceRichSyntax(value: string) {
  let result = '';
  let offset = 0;
  while (offset < value.length) {
    const opening = /`+/u.exec(value.slice(offset));
    if (!opening || opening.index === undefined) return result + replaceRichSyntaxText(value.slice(offset));
    const start = offset + opening.index;
    const ticks = opening[0];
    const end = value.indexOf(ticks, start + ticks.length);
    if (end < 0) return result + replaceRichSyntaxText(value.slice(offset));
    result += replaceRichSyntaxText(value.slice(offset, start));
    result += value.slice(start, end + ticks.length);
    offset = end + ticks.length;
  }
  return result;
}

function normalizedRichMarkdown(value: string) {
  const result: string[] = [];
  const outside: string[] = [];
  let fence = '';
  const flush = () => {
    if (outside.length) result.push(replaceRichSyntax(outside.join('\n')));
    outside.length = 0;
  };
  for (const line of value.split(/\r?\n/u)) {
    const marker = /^\s*(`{3,}|~{3,})/u.exec(line)?.[1]?.[0] ?? '';
    if (!fence && marker) {
      flush();
      fence = marker;
      result.push(line);
    } else if (fence) {
      result.push(line);
      if (marker === fence) fence = '';
    } else outside.push(line);
  }
  flush();
  return result.join('\n');
}

function textContent(children: ReactNode): string {
  if (children == null || typeof children === 'boolean') return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(textContent).join('');
  return isValidElement<{ children?: ReactNode }>(children) ? textContent(children.props.children) : '';
}

export const CodexHistoryMessageMarkdown = memo(function CodexHistoryMessageMarkdown({
  text,
  query = '',
  onOpenThread,
}: {
  text: string;
  query?: string;
  onOpenThread?(threadId: string): void;
}) {
  const l = useI18n().messages.extensions.codexHistorySearch;
  const rehypePlugins = useMemo(
    () =>
      query
        ? [[codexHistoryMarkdownHighlights, { query }] as [typeof codexHistoryMarkdownHighlights, { query: string }]]
        : [],
    [query],
  );
  const components = useMemo<Components>(
    () => ({
      mark: ({ children }) => <mark className={historyHighlightClassName}>{children}</mark>,
      p: ({ node: _node, ...props }) => <p {...props} className="whitespace-pre-wrap" />,
      a: ({ children, href }) => {
        const threadId = href ? parseCodexThreadHref(href) : null;
        const external = Boolean(href && /^https?:\/\//iu.test(href));
        if ((!threadId || !onOpenThread) && !external)
          return (
            <span className="font-mono text-[0.92em] text-muted-foreground" title={href}>
              {children}
            </span>
          );
        return (
          <a
            href={href}
            className="text-[var(--button-primary)] underline underline-offset-2"
            onClick={(event) => {
              event.preventDefault();
              if (threadId && onOpenThread) onOpenThread(threadId);
              else if (href)
                void contentLibraryApi()
                  .linkOpen(href)
                  .catch(() => undefined);
            }}
          >
            {children}
          </a>
        );
      },
      img: ({ alt, src }) =>
        src?.startsWith('aiy-media://codex-history/') ? (
          <span className="my-2 block max-w-full overflow-hidden border-y bg-surface-sunken/30 py-2">
            <img src={src} alt={alt ?? ''} loading="lazy" className="max-h-[36rem] max-w-full object-contain" />
          </span>
        ) : (
          <span
            className="font-mono text-xs text-muted-foreground"
            title={src && src.length <= 2_048 && !src.startsWith('data:') ? src : undefined}
          >
            {alt || (src?.startsWith('data:') ? l.media.EMBEDDED_IMAGE : src?.slice(0, 500))}
          </span>
        ),
      code: ({ className, children, node: _node, ...props }) => {
        const source = textContent(children).replace(/\n$/u, '');
        if (className?.split(/\s+/u).includes('language-mermaid'))
          return <CodexHistoryMermaid source={source} label={l.formats.diagram} />;
        if (className?.split(/\s+/u).includes('language-math')) return <CodexHistoryMath source={source} display />;
        if (className?.split(/\s+/u).includes('codex-math-inline'))
          return <CodexHistoryMath source={source} display={false} />;
        return (
          <code {...props} className={className}>
            {children}
          </code>
        );
      },
      pre: ({ children, node: _node, ...props }) =>
        isValidElement(children) && (children.type === CodexHistoryMermaid || children.type === CodexHistoryMath) ? (
          children
        ) : (
          <pre {...props}>{children}</pre>
        ),
    }),
    [l.formats.diagram, l.media.EMBEDDED_IMAGE, onOpenThread],
  );
  return (
    <ContentMarkdown
      typography="compact"
      className="text-sm leading-6 [content-visibility:auto] [contain-intrinsic-size:auto_160px]"
      components={components}
      remarkPlugins={[codexHistoryMarkdownMath]}
      rehypePlugins={rehypePlugins}
      skipHtml={false}
      urlTransform={historyMarkdownUrlTransform}
    >
      {normalizedRichMarkdown(text)}
    </ContentMarkdown>
  );
});
