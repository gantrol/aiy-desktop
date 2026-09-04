import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { codexMarkdownUrlTransform } from '@/renderer/lib/codexThreadLinks';

const markdownComponents: Components = {
  h1: ({ children }) => <h1 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 mt-4 text-sm font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1.5 mt-3 text-sm font-medium first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1.5 mt-3 text-xs font-semibold first:mt-0">{children}</h4>,
  p: ({ children }) => <p className="my-2 whitespace-pre-wrap first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children, start }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5" start={start}>
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>
  ),
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-md border bg-surface-sunken px-3 py-2 font-mono text-xs leading-5 [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  code: ({ children, className }) => (
    <code className={`rounded-sm bg-surface-sunken px-1 py-0.5 font-mono text-[0.875em] ${className ?? ''}`}>
      {children}
    </code>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto border-y">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b bg-surface-sunken px-2 py-1.5 text-left font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b px-2 py-1.5 align-top last:border-b-0">{children}</td>,
  a: ({ children, href }) => (
    <span className="text-[var(--button-primary)] underline underline-offset-2" title={href}>
      {children}
    </span>
  ),
  img: ({ alt, src }) => (
    <span className="font-mono text-xs text-muted-foreground" title={src}>
      {alt || src}
    </span>
  ),
  hr: () => <hr className="my-4 border-border" />,
  input: ({ checked, type }) =>
    type === 'checkbox' ? (
      <span aria-hidden="true" className="mr-1 font-mono text-muted-foreground">
        {checked ? '[x]' : '[ ]'}
      </span>
    ) : null,
};

export const CodexHistoryMessageMarkdown = memo(function CodexHistoryMessageMarkdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words text-sm leading-6 [content-visibility:auto] [contain-intrinsic-size:auto_160px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
        skipHtml
        urlTransform={codexMarkdownUrlTransform}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
