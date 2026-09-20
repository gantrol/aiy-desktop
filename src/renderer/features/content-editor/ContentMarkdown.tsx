import ReactMarkdown, { type Components, type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ComponentPropsWithoutRef } from 'react';
import { ContentMarkdownCheckbox } from '@/renderer/features/content-editor/ContentMarkdownCheckbox';
import {
  contentTypographyClassName,
  type ContentTypography,
} from '@/renderer/features/content-editor/contentEditorTypography';
import { cn } from '@/renderer/lib/utils';

const contentMarkdownComponents: Components = {
  input: ContentMarkdownCheckbox,
  table: ({ node: _node, ...props }) => (
    <div className="tableWrapper max-w-full overflow-x-auto">
      <table {...props} />
    </div>
  ),
};

interface Props extends Omit<Options, 'className'> {
  typography: ContentTypography;
  className?: string;
  containerProps?: Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'className'> & {
    [attribute: `data-${string}`]: string | boolean | undefined;
  };
}

/** Document previews share GFM semantics and typography; hosts only resolve their links, media and headings. */
export function ContentMarkdown({
  typography,
  className,
  components,
  containerProps,
  remarkPlugins,
  skipHtml = true,
  ...props
}: Props) {
  return (
    <div {...containerProps} className={cn(contentTypographyClassName(typography), 'whitespace-normal', className)}>
      <ReactMarkdown
        {...props}
        remarkPlugins={[remarkGfm, ...(remarkPlugins ?? [])]}
        skipHtml={skipHtml}
        components={{ ...contentMarkdownComponents, ...components }}
      />
    </div>
  );
}
