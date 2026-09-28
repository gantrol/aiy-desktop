import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { useI18n } from '@/renderer/i18n/useI18n';
import { openAppContentLink } from '@/renderer/components/app/app-content-link';
import { codexThreadIdSchema, codexThreadHref } from '@/shared/contracts/codex-thread';
import type { ContentAuthor, ContentProvenance as Provenance } from '@/shared/contracts/content-provenance';
import type { contentProvenanceMessages } from '@/shared/i18n/content-provenance';

type Labels = typeof contentProvenanceMessages;
export function contentAuthorLabel(author: ContentAuthor, labels: Labels): string {
  if (author.kind === 'AI')
    return labels.applications[author.application as keyof Labels['applications']] ?? author.application;
  return ('name' in author && author.name) || labels.kinds[author.kind];
}

function Author({ author }: { author: ContentAuthor }) {
  const l = useI18n().messages.contentProvenance;
  const [failed, setFailed] = useState(false);
  const thread =
    author.kind === 'AI' && author.application === 'codex' && codexThreadIdSchema.safeParse(author.threadId);
  return (
    <div className="grid gap-1 break-words">
      <span>{contentAuthorLabel(author, l)}</span>
      {author.kind === 'AI' && (
        <>
          {author.agentId && (
            <span>
              {l.agent}: {author.agentId}
            </span>
          )}
          {author.model && (
            <span>
              {l.model}: {author.model}
            </span>
          )}
          {thread && thread.success ? (
            <Button
              variant="link"
              size="sm"
              className="h-auto justify-start p-0"
              onClick={() => {
                setFailed(false);
                void window.desktopApi.contentLibrary
                  .linkOpen(codexThreadHref(thread.data))
                  .catch(() => setFailed(true));
              }}
            >
              {l.thread}
            </Button>
          ) : (
            author.threadId && (
              <span>
                {l.thread}: {author.threadId}
              </span>
            )
          )}
        </>
      )}
      {failed && <span role="alert">{l.openFailed}</span>}
    </div>
  );
}

export function ContentProvenanceDetails({ value }: { value?: Provenance }) {
  const l = useI18n().messages.contentProvenance;
  const [failed, setFailed] = useState(false);
  return (
    <div className="grid gap-3 text-xs">
      <div className="grid gap-1">
        <span className="text-muted-foreground" title={l.declared}>
          {l.authors}
        </span>
        {(value?.authors ?? [{ kind: 'UNKNOWN' } as const]).map((author, index) => (
          <Author key={index} author={author} />
        ))}
      </div>
      {value && (
        <>
          <div className="grid gap-1">
            <span className="text-muted-foreground">{l.writer}</span>
            <Author author={value.writer} />
          </div>
          <div>
            {l.operation}: {l.operations[value.operation]}
          </div>
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
                  onClick={() => {
                    setFailed(false);
                    if (!openAppContentLink(source.url))
                      void window.desktopApi.contentLibrary.linkOpen(source.url).catch(() => setFailed(true));
                  }}
                >
                  {source.url}
                  {source.occurredAt ? ` · ${source.occurredAt}` : ''}
                </Button>
              ))}
            </div>
          )}
        </>
      )}
      {failed && <span role="alert">{l.openFailed}</span>}
    </div>
  );
}

export function ContentProvenanceCell({ value }: { value?: Provenance }) {
  const l = useI18n().messages.contentProvenance;
  const names = [
    ...new Set((value?.authors ?? [{ kind: 'UNKNOWN' } as const]).map((author) => contentAuthorLabel(author, l))),
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto max-w-full justify-start whitespace-normal px-0 text-left"
          aria-label={`${l.title}: ${names.join(' · ')}`}
        >
          {names.join(' · ')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-96 w-80 overflow-y-auto">
        <ContentProvenanceDetails value={value} />
      </PopoverContent>
    </Popover>
  );
}
