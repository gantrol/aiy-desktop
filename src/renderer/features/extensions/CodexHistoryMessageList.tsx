import { useMemo } from 'react';
import { ChevronDownIcon, ChevronUpIcon, LoaderCircleIcon, UserIcon } from 'lucide-react';
import type { CodexHistoryMessage } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { modelDisplayName, ModelMark } from '@/renderer/components/model/ModelIdentity';
import { CodexHistoryMessageContent } from '@/renderer/features/extensions/CodexHistoryMessageContent';
import type { useCodexHistoryMessages } from '@/renderer/features/extensions/useCodexHistoryMessages';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  state: ReturnType<typeof useCodexHistoryMessages>;
  query: string;
  pendingQuery: boolean;
  dateFormatter: Intl.DateTimeFormat;
  onOpenThread(threadId: string): void;
}

type MessageEntry =
  | { kind: 'MESSAGE'; message: CodexHistoryMessage }
  | { kind: 'COMMENTARY'; key: string; turnId: string | null; messages: CodexHistoryMessage[] };

function messageEntries(messages: CodexHistoryMessage[]): MessageEntry[] {
  const entries: MessageEntry[] = [];
  for (const message of messages) {
    if (message.phase !== 'COMMENTARY') {
      entries.push({ kind: 'MESSAGE', message });
      continue;
    }
    const previous = entries.at(-1);
    if (previous?.kind === 'COMMENTARY' && previous.turnId === message.turnId) previous.messages.push(message);
    else
      entries.push({
        kind: 'COMMENTARY',
        key: `commentary-${message.messageId}`,
        turnId: message.turnId,
        messages: [message],
      });
  }
  return entries;
}

function MessageAvatar({ message, model }: { message: CodexHistoryMessage; model: string | null }) {
  return message.role === 'USER' ? (
    <span className="mt-0.5 grid size-7 place-items-center rounded-md bg-surface-sunken text-muted-foreground">
      <UserIcon className="size-3.5" />
    </span>
  ) : (
    <ModelMark providerKey="openai" modelId={model ?? 'codex'} className="mt-0.5 size-7" />
  );
}

function MessageRow({
  message,
  state,
  query,
  filtering,
  pendingQuery,
  dateFormatter,
  onOpenThread,
}: {
  message: CodexHistoryMessage;
  state: Props['state'];
  query: string;
  filtering: boolean;
  pendingQuery: boolean;
  dateFormatter: Intl.DateTimeFormat;
  onOpenThread(threadId: string): void;
}) {
  const l = useI18n().messages.extensions.codexHistorySearch;
  const { page } = state;
  return (
    <article
      tabIndex={-1}
      ref={message.messageId === state.focusMessageId ? state.focusRef : undefined}
      data-current={message.messageId === state.focusMessageId || undefined}
      className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2.5 px-4 py-3 outline-none data-[current]:bg-warning-surface/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <MessageAvatar message={message} model={page?.model ?? null} />
      <div className="min-w-0">
        <div className="mb-1 flex min-h-5 flex-wrap items-center gap-2 text-2xs text-muted-foreground">
          <span
            className="font-medium text-foreground"
            title={
              message.role === 'ASSISTANT' && page?.model
                ? `${page.modelProvider ?? 'openai'} · ${page.model}`
                : undefined
            }
          >
            {message.role === 'USER'
              ? l.preview.user
              : page?.model
                ? modelDisplayName(page.model)
                : l.preview.assistant}
          </span>
          <time dateTime={message.createdAt}>{dateFormatter.format(new Date(message.createdAt))}</time>
          {message.phase && message.phase !== 'FINAL' && <Badge variant="outline">{l.phases[message.phase]}</Badge>}
          {filtering && message.position && (
            <Button
              type="button"
              variant="ghost"
              size="2xs"
              className="ml-auto"
              disabled={pendingQuery}
              onClick={() => void state.viewContext(message)}
            >
              {l.preview.viewContext}
            </Button>
          )}
        </div>
        <CodexHistoryMessageContent
          blocks={message.blocks}
          fallbackText={message.text}
          query={query}
          onOpenThread={onOpenThread}
        />
      </div>
    </article>
  );
}

function CommentaryRow({
  entry,
  state,
  query,
  filtering,
  pendingQuery,
  dateFormatter,
  onOpenThread,
}: {
  entry: Extract<MessageEntry, { kind: 'COMMENTARY' }>;
  state: Props['state'];
  query: string;
  filtering: boolean;
  pendingQuery: boolean;
  dateFormatter: Intl.DateTimeFormat;
  onOpenThread(threadId: string): void;
}) {
  const l = useI18n().messages.extensions.codexHistorySearch;
  const focused = entry.messages.some(({ messageId }) => messageId === state.focusMessageId);
  const first = entry.messages[0]!;
  return (
    <article
      tabIndex={-1}
      ref={focused ? state.focusRef : undefined}
      data-current={focused || undefined}
      className="px-4 py-2 outline-none data-[current]:bg-warning-surface/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <Collapsible defaultOpen={filtering || focused} className="group/commentary">
        <div className="flex min-w-0 items-center gap-2 text-2xs text-muted-foreground">
          <ModelMark providerKey="openai" modelId={state.page?.model ?? 'codex'} className="size-6" />
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" size="xs" className="min-w-0">
              <span className="truncate font-medium text-foreground">{l.phases.COMMENTARY}</span>
              <span className="tabular-nums">{entry.messages.length}</span>
              <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]/commentary:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <time className="ml-auto shrink-0" dateTime={first.createdAt}>
            {dateFormatter.format(new Date(first.createdAt))}
          </time>
        </div>
        <CollapsibleContent className="ml-8 divide-y border-l pl-3">
          {entry.messages.map((message) => (
            <div key={message.messageId} className="py-2">
              {filtering && message.position && (
                <div className="mb-1 flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="2xs"
                    disabled={pendingQuery}
                    onClick={() => void state.viewContext(message)}
                  >
                    {l.preview.viewContext}
                  </Button>
                </div>
              )}
              <CodexHistoryMessageContent
                blocks={message.blocks}
                fallbackText={message.text}
                query={query}
                onOpenThread={onOpenThread}
              />
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </article>
  );
}

export function CodexHistoryMessageList({ state, query, pendingQuery, dateFormatter, onOpenThread }: Props) {
  const l = useI18n().messages.extensions.codexHistorySearch;
  const { page } = state;
  const filtering = state.filtered && !state.anchor;
  const visibleMessages = useMemo(
    () => (filtering ? [...(page?.messages ?? [])].reverse() : (page?.messages ?? [])),
    [filtering, page?.messages],
  );
  const entries = useMemo(() => messageEntries(visibleMessages), [visibleMessages]);
  const olderButton = page?.nextCursor != null && (
    <div className="flex justify-center border-y p-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={state.loading || Boolean(state.loadingMore) || pendingQuery}
        onClick={() => void state.loadMore('OLDER')}
      >
        {state.loadingMore === 'OLDER' ? (
          <LoaderCircleIcon className="size-3.5 animate-spin" />
        ) : filtering ? (
          <ChevronDownIcon className="size-3.5" />
        ) : (
          <ChevronUpIcon className="size-3.5" />
        )}
        {filtering ? (page.scanLimited ? l.preview.continueSearch : l.preview.moreMatches) : l.preview.loadOlder}
      </Button>
    </div>
  );

  return (
    <div
      ref={state.containerRef}
      className="min-h-0 flex-1 overflow-y-auto"
      aria-busy={state.loading || Boolean(state.loadingMore) || pendingQuery}
    >
      {state.anchor && page && !page.messages.some(({ messageId }) => messageId === state.anchor?.messageId) && (
        <div role="status" className="border-b px-4 py-2 text-xs text-muted-foreground">
          {l.preview.contextUnavailable}
        </div>
      )}
      {!filtering && olderButton}
      {state.loading ? (
        <div className="grid min-h-40 place-items-center">
          <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" aria-label={l.preview.loading} />
        </div>
      ) : entries.length ? (
        <div className="divide-y">
          {entries.map((entry) =>
            entry.kind === 'MESSAGE' ? (
              <MessageRow
                key={entry.message.messageId}
                message={entry.message}
                state={state}
                query={query}
                filtering={filtering}
                pendingQuery={pendingQuery}
                dateFormatter={dateFormatter}
                onOpenThread={onOpenThread}
              />
            ) : (
              <CommentaryRow
                key={entry.key}
                entry={entry}
                state={state}
                query={query}
                filtering={filtering}
                pendingQuery={pendingQuery}
                dateFormatter={dateFormatter}
                onOpenThread={onOpenThread}
              />
            ),
          )}
        </div>
      ) : (
        !state.error && (
          <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">
            {filtering
              ? page?.nextCursor != null
                ? l.preview.noMatchesYet
                : l.preview.noMatches
              : l.preview.noMessages}
          </div>
        )
      )}
      {filtering && olderButton}
      {state.anchor && page?.newerCursor != null && (
        <div className="flex justify-center border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={Boolean(state.loadingMore)}
            onClick={() => void state.loadMore('NEWER')}
          >
            {state.loadingMore === 'NEWER' ? (
              <LoaderCircleIcon className="size-3.5 animate-spin" />
            ) : (
              <ChevronDownIcon className="size-3.5" />
            )}
            {l.preview.loadNewer}
          </Button>
        </div>
      )}
      {state.error && (
        <div role="alert" className="flex items-center gap-2 border-t px-4 py-3 text-xs text-destructive">
          <span className="min-w-0 flex-1">{state.error}</span>
          {!page && (
            <Button type="button" variant="ghost" size="sm" onClick={state.retry}>
              {l.actions.retry}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
