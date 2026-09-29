import type { Editor } from '@tiptap/core';
import { useState, type ReactNode } from 'react';
import { MoreHorizontalIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Separator } from '@/renderer/components/ui/separator';
import { ContentToolbar } from '@/renderer/features/content-editor/ContentToolbar';
import type { VideoDocumentWysiwygEditorLabels } from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import { cn } from '@/renderer/lib/utils';

interface ToolbarSection {
  id: string;
  label: string;
  content: ReactNode;
  minimumWidth: number;
}

function ToolbarOverflow({
  editor,
  label,
  sections,
}: {
  editor: Editor;
  label: string;
  sections: readonly ToolbarSection[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          aria-label={label}
          title={label}
          data-content-toolbar-more
        >
          <MoreHorizontalIcon className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={label}
        className="max-h-[var(--radix-popover-content-available-height)] w-auto max-w-[calc(100vw-1rem)] space-y-2 overflow-y-auto p-2"
        onKeyDownCapture={(event) => {
          if (event.key === 'Escape' && event.currentTarget.contains(event.target as Node)) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
        onCloseAutoFocus={(event) => {
          // Editor commands restore the retained selection; closing must not steal that focus.
          if (editor.isFocused) event.preventDefault();
        }}
      >
        {sections.map((section) => (
          <div key={section.id} role="group" aria-label={section.label} className="grid gap-1">
            <span className="text-xs text-muted-foreground">{section.label}</span>
            <div className="flex flex-wrap items-center gap-0.5">{section.content}</div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Keep every full-editor command while making the narrow layout fit its pane. */
export function FullContentToolbar({
  editor,
  embedded,
  labels,
  formatting,
  list,
  insert,
  structure,
  articleTools,
  review,
  history,
  search,
}: {
  editor: Editor;
  embedded?: boolean;
  labels: VideoDocumentWysiwygEditorLabels;
  formatting: { heading: ReactNode; bold: ReactNode; italic: ReactNode; strike: ReactNode; link: ReactNode };
  list: ReactNode;
  insert: ReactNode;
  structure: ReactNode;
  articleTools: ReactNode;
  review: ReactNode;
  history: ReactNode;
  search?: ReactNode;
}) {
  const sections: ToolbarSection[] = [
    {
      id: 'formatting',
      label: labels.formatting,
      content: (
        <>
          {formatting.italic}
          {formatting.strike}
        </>
      ),
      minimumWidth: 440,
    },
    { id: 'lists', label: labels.formatting, content: list, minimumWidth: 680 },
    { id: 'insert', label: labels.insert, content: insert, minimumWidth: 680 },
    { id: 'structure', label: labels.formatting, content: structure, minimumWidth: 960 },
    { id: 'article-tools', label: labels.articleTools, content: articleTools, minimumWidth: 960 },
    { id: 'review', label: labels.review, content: review, minimumWidth: 960 },
  ].filter((section) => section.content);
  return (
    <ContentToolbar
      label={labels.formatting}
      className={cn(
        'z-30',
        embedded ? 'relative border-0 bg-transparent text-inherit' : 'sticky top-0 bg-background/96 backdrop-blur-sm',
      )}
    >
      {(_narrow, width) => {
        const overflow = sections.filter((section) => width < section.minimumWidth);
        return (
          <>
            {history}
            <Separator orientation="vertical" className="mx-1 h-4 shrink-0" />
            {formatting.heading}
            {formatting.bold}
            {formatting.link}
            {sections
              .filter((section) => width >= section.minimumWidth)
              .map((section) => (
                <span key={section.id} className="flex shrink-0 items-center gap-0.5">
                  <Separator orientation="vertical" className="mx-1 h-4 shrink-0" />
                  {section.content}
                </span>
              ))}
            {search}
            {overflow.length > 0 && <ToolbarOverflow editor={editor} label={labels.more} sections={overflow} />}
          </>
        );
      }}
    </ContentToolbar>
  );
}
