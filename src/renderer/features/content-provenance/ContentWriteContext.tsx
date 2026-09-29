import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import { openAppContentLink } from '@/renderer/components/app/app-content-link';
import { codexThreadIdSchema, codexThreadHref } from '@/shared/contracts/codex-thread';
import type { ContentAuthor } from '@/shared/contracts/content-provenance';
import type { ContentWriteContext } from '@/shared/contracts/authorship';
import type { contentProvenanceMessages } from '@/shared/i18n/content-provenance';
import { authorDisplayName } from '@/renderer/features/me/AuthorNames';

/** Historical calendar declarations predate the author registry. */
export function contentAuthorLabel(author: ContentAuthor, labels: typeof contentProvenanceMessages): string {
  if (author.kind === 'AI')
    return labels.applications[author.application as keyof typeof labels.applications] ?? author.application;
  return ('name' in author && author.name) || labels.kinds[author.kind];
}

export function hasContentWriteContextDetails(value?: ContentWriteContext): value is ContentWriteContext {
  return Boolean(value && (value.writer || value.operation !== 'UNKNOWN' || value.batchId || value.sources.length));
}

export function ContentWriteContextDetails({ value }: { value?: ContentWriteContext }) {
  const { messages } = useI18n(),
    l = messages.contentProvenance;
  const [failed, setFailed] = useState(false);
  if (!hasContentWriteContextDetails(value)) return null;
  const thread = value.writer?.application === 'codex' && codexThreadIdSchema.safeParse(value.threadId);
  const open = (url: string) => {
    setFailed(false);
    if (!openAppContentLink(url)) void window.desktopApi.contentLibrary.linkOpen(url).catch(() => setFailed(true));
  };
  return (
    <div className="grid gap-3 text-xs">
      {value.writer && (
        <div>
          {l.writer}: {authorDisplayName(value.writer, messages)}
        </div>
      )}
      {value.agentId && (
        <div className="break-all">
          {l.agent}: {value.agentId}
        </div>
      )}
      {value.model && (
        <div className="break-all">
          {l.model}: {value.model}
        </div>
      )}
      {thread && thread.success ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto justify-start p-0"
          onClick={() => open(codexThreadHref(thread.data))}
        >
          {l.thread}
        </Button>
      ) : (
        value.threadId && (
          <div className="break-all">
            {l.thread}: {value.threadId}
          </div>
        )
      )}
      {value.operation !== 'UNKNOWN' && (
        <div>
          {l.operation}: {l.operations[value.operation]}
        </div>
      )}
      {value.batchId && (
        <div className="break-all">
          {l.batch}: {value.batchId}
        </div>
      )}
      {value.sources.length > 0 && (
        <div className="grid gap-1">
          <span className="text-muted-foreground">{l.sources}</span>
          {value.sources.map((source, index) => (
            <Button
              key={index}
              variant="link"
              size="sm"
              className="h-auto justify-start whitespace-normal break-all p-0 text-left"
              onClick={() => open(source.url)}
            >
              {source.url}
              {source.occurredAt ? ' · ' + source.occurredAt : ''}
            </Button>
          ))}
        </div>
      )}
      {failed && <span role="alert">{l.openFailed}</span>}
    </div>
  );
}

export function ContentWriteContextCell({ value }: { value?: ContentWriteContext }) {
  const { messages } = useI18n(),
    l = messages.contentProvenance;
  if (!hasContentWriteContextDetails(value)) return null;
  const name = value.writer ? authorDisplayName(value.writer, messages) : l.operations[value.operation];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto max-w-full justify-start whitespace-normal px-0 text-left"
          aria-label={l.writer + ': ' + name}
        >
          {name}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-96 w-80 overflow-y-auto">
        <ContentWriteContextDetails value={value} />
      </PopoverContent>
    </Popover>
  );
}
