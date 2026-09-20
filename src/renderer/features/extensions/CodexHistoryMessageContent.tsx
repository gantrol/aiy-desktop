import {
  ChevronDownIcon,
  CircleHelpIcon,
  ClockIcon,
  Code2Icon,
  FileImageIcon,
  GitForkIcon,
  GlobeIcon,
  MessageSquareQuoteIcon,
  MessageSquareIcon,
  MicIcon,
  PaperclipIcon,
  PuzzleIcon,
  TerminalIcon,
  TextSelectIcon,
  UserIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';
import type { CodexHistoryContextKind, CodexHistoryMessageBlock } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { CodexHistoryHighlightedText } from '@/renderer/features/extensions/CodexHistoryHighlightedText';
import { CodexHistoryMessageMarkdown } from '@/renderer/features/extensions/CodexHistoryMessageMarkdown';
import { useI18n } from '@/renderer/i18n/useI18n';

const iconByKind: Record<CodexHistoryContextKind, ComponentType<{ className?: string }>> = {
  ATTACHMENTS: PaperclipIcon,
  BROWSER: GlobeIcon,
  CHATGPT_REFERENCE: MessageSquareQuoteIcon,
  ANNOTATIONS: MessageSquareQuoteIcon,
  QUESTION_REPLY: CircleHelpIcon,
  DELEGATION: GitForkIcon,
  REALTIME: MicIcon,
  AUTOMATION: ClockIcon,
  IDE: Code2Icon,
  SELECTION: TextSelectIcon,
  COMMAND: TerminalIcon,
  SKILL: PuzzleIcon,
  MENTION: MessageSquareIcon,
  WRITING: Code2Icon,
  OTHER: MessageSquareQuoteIcon,
};

interface ContentProps {
  blocks: CodexHistoryMessageBlock[];
  fallbackText: string;
  query: string;
  onOpenThread?(threadId: string): void;
}

function ContextBlock({
  block,
  query,
  onOpenThread,
}: {
  block: Extract<CodexHistoryMessageBlock, { type: 'CONTEXT' }>;
  query: string;
  onOpenThread?: (threadId: string) => void;
}) {
  const l = useI18n().messages.extensions.codexHistorySearch;
  const Icon = iconByKind[block.kind];
  const itemCount = block.items.length;
  return (
    <Collapsible defaultOpen={Boolean(query)} className="group/context border-l-2 border-border pl-2">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="xs" className="max-w-full gap-1.5 text-muted-foreground">
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">
            <CodexHistoryHighlightedText text={block.title || l.formats[block.kind]} query={query} />
          </span>
          {itemCount > 0 && <span className="tabular-nums">{itemCount}</span>}
          <ChevronDownIcon className="size-3.5 shrink-0 transition-transform group-data-[state=open]/context:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pb-1 pl-1 pt-2">
        {block.reference && (
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <code className="min-w-0 truncate">{block.reference}</code>
            {block.kind === 'DELEGATION' && onOpenThread && (
              <Button type="button" variant="ghost" size="2xs" onClick={() => onOpenThread(block.reference!)}>
                {l.preview.open}
              </Button>
            )}
          </div>
        )}
        {block.text && <CodexHistoryMessageMarkdown text={block.text} query={query} onOpenThread={onOpenThread} />}
        {block.items.map((item, index) => (
          <div
            key={`${index}-${item.label}-${item.reference ?? ''}`}
            className="border-t pt-2 first:border-t-0 first:pt-0"
          >
            {(item.role || item.label) && (
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {item.role === 'USER' ? (
                  <UserIcon className="size-3.5" />
                ) : item.role === 'ASSISTANT' ? (
                  <MessageSquareIcon className="size-3.5" />
                ) : null}
                <span>
                  <CodexHistoryHighlightedText
                    text={item.label || (item.role ? l.roles[item.role] : '')}
                    query={query}
                  />
                </span>
              </div>
            )}
            {item.text && <CodexHistoryMessageMarkdown text={item.text} query={query} onOpenThread={onOpenThread} />}
            {item.reference && <code className="block truncate text-xs text-muted-foreground">{item.reference}</code>}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function MediaBlock({
  block,
  query,
  onOpenThread,
}: {
  block: Extract<CodexHistoryMessageBlock, { type: 'MEDIA' }>;
  query: string;
  onOpenThread?: (threadId: string) => void;
}) {
  const l = useI18n().messages.extensions.codexHistorySearch;
  const label = block.alt || l.media[block.kind];
  return (
    <div className="space-y-2 border-y py-2">
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <FileImageIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          <CodexHistoryHighlightedText text={label} query={query} />
        </span>
        {block.status && (
          <Badge variant="outline" className={block.status === 'FAILED' ? 'text-destructive' : undefined}>
            {l.media[block.status]}
          </Badge>
        )}
      </div>
      {block.mediaUrl ? (
        <img
          src={block.mediaUrl}
          alt={block.alt || l.media[block.kind]}
          loading="lazy"
          className="max-h-[36rem] max-w-full object-contain"
        />
      ) : block.kind === 'REMOTE_IMAGE' && block.source ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            void contentLibraryApi()
              .linkOpen(block.source!)
              .catch(() => undefined)
          }
        >
          <GlobeIcon className="size-3.5" />
          {l.media.openSource}
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">{l.media.unavailable}</span>
      )}
      {block.error && (
        <div className="text-destructive">
          <div className="mb-1 text-xs font-medium">{l.media.failure}</div>
          <CodexHistoryMessageMarkdown text={block.error} query={query} onOpenThread={onOpenThread} />
        </div>
      )}
      {block.prompt && (
        <Collapsible defaultOpen={Boolean(query)} className="group/prompt">
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="xs" className="text-muted-foreground">
              {l.media.prompt}
              <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]/prompt:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1">
            <CodexHistoryMessageMarkdown text={block.prompt} query={query} onOpenThread={onOpenThread} />
          </CollapsibleContent>
        </Collapsible>
      )}
      {block.source && (
        <code className="block truncate text-xs text-muted-foreground" title={block.source}>
          <CodexHistoryHighlightedText text={block.source} query={query} />
        </code>
      )}
    </div>
  );
}

function DirectiveBlock({
  block,
  query,
  onOpenThread,
}: {
  block: Extract<CodexHistoryMessageBlock, { type: 'DIRECTIVE' }>;
  query: string;
  onOpenThread?: (threadId: string) => void;
}) {
  const l = useI18n().messages.extensions.codexHistorySearch;
  const entries = Object.entries(block.attributes);
  const body = block.attributes.body ?? block.attributes.text ?? '';
  const threadId = block.attributes.threadId ?? block.attributes.thread_id;
  return (
    <div className="border-l-2 border-border py-1 pl-2 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{block.name}</Badge>
        {block.attributes.title && <span className="font-medium">{block.attributes.title}</span>}
        {threadId && onOpenThread && (
          <Button type="button" variant="ghost" size="2xs" onClick={() => onOpenThread(threadId)}>
            {l.preview.open}
          </Button>
        )}
      </div>
      {body && (
        <div className="mt-1">
          <CodexHistoryMessageMarkdown text={body} query={query} onOpenThread={onOpenThread} />
        </div>
      )}
      {entries.some(([key]) => !['body', 'text', 'title', 'threadId', 'thread_id'].includes(key)) && (
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-muted-foreground">
          {entries
            .filter(([key]) => !['body', 'text', 'title', 'threadId', 'thread_id'].includes(key))
            .map(([key, value]) => (
              <code key={key} className="max-w-full truncate" title={`${key}=${value}`}>
                <CodexHistoryHighlightedText text={`${key}=${value}`} query={query} />
              </code>
            ))}
        </div>
      )}
    </div>
  );
}

export function CodexHistoryMessageContent({ blocks, fallbackText, query, onOpenThread }: ContentProps) {
  const effectiveBlocks: CodexHistoryMessageBlock[] =
    blocks.length || !fallbackText ? blocks : [{ type: 'MARKDOWN', text: fallbackText }];
  return (
    <div className="space-y-2">
      {effectiveBlocks.map((block, index) => {
        if (block.type === 'MARKDOWN')
          return (
            <CodexHistoryMessageMarkdown
              key={`${index}-markdown`}
              text={block.text}
              query={query}
              onOpenThread={onOpenThread}
            />
          );
        if (block.type === 'CONTEXT')
          return (
            <ContextBlock key={`${index}-${block.kind}`} block={block} query={query} onOpenThread={onOpenThread} />
          );
        if (block.type === 'MEDIA')
          return <MediaBlock key={`${index}-${block.kind}`} block={block} query={query} onOpenThread={onOpenThread} />;
        return (
          <DirectiveBlock key={`${index}-${block.name}`} block={block} query={query} onOpenThread={onOpenThread} />
        );
      })}
    </div>
  );
}
