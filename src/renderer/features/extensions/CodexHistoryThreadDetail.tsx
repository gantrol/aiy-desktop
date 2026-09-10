import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronUpIcon, ExternalLinkIcon, LoaderCircleIcon, UserIcon } from 'lucide-react';
import type { CodexHistoryMessage, CodexHistorySearchResult, CodexHistoryThreadMessagesPage } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { modelDisplayName, ModelIdentity, ModelMark } from '@/renderer/components/model/ModelIdentity';
import { CodexHistoryMessageMarkdown } from '@/renderer/features/extensions/CodexHistoryMessageMarkdown';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CodexHistoryThreadUsage } from '@/renderer/features/extensions/CodexHistoryThreadUsage';

const MESSAGE_PAGE_SIZE = 20;

interface Props {
  item: CodexHistorySearchResult | null;
  locale: string;
  onOpen(threadId: string): void;
  onClose(): void;
}

function mergedMessages(older: readonly CodexHistoryMessage[], current: readonly CodexHistoryMessage[]) {
  const known = new Set(older.map(({ messageId }) => messageId));
  return [...older, ...current.filter(({ messageId }) => !known.has(messageId))];
}

export function CodexHistoryThreadDetail({ item, locale, onOpen, onClose }: Props) {
  const l = useI18n().messages.extensions.codexHistorySearch;
  const [page, setPage] = useState<CodexHistoryThreadMessagesPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRevision = useRef(0);
  const scrollContainer = useRef<HTMLDivElement | null>(null);
  const scrollAdjustment = useRef<{ height: number; top: number } | 'BOTTOM' | null>(null);
  const threadId = item?.threadId ?? null;
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  useEffect(() => {
    const revision = ++requestRevision.current;
    setPage(null);
    setError(null);
    setLoadingOlder(false);
    if (!threadId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void window.desktopApi
      .codexHistoryThreadMessages({ threadId, cursor: null, pageSize: MESSAGE_PAGE_SIZE })
      .then((next) => {
        if (requestRevision.current !== revision) return;
        scrollAdjustment.current = 'BOTTOM';
        setPage(next);
      })
      .catch((reason) => {
        if (requestRevision.current !== revision) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (requestRevision.current === revision) setLoading(false);
      });
    return () => {
      requestRevision.current += 1;
    };
  }, [threadId]);

  useLayoutEffect(() => {
    const container = scrollContainer.current;
    const adjustment = scrollAdjustment.current;
    if (!container || !adjustment) return;
    if (adjustment === 'BOTTOM') container.scrollTop = container.scrollHeight;
    else container.scrollTop = container.scrollHeight - adjustment.height + adjustment.top;
    scrollAdjustment.current = null;
  }, [page]);

  const loadOlder = useCallback(async () => {
    if (!threadId || !page || page.nextCursor === null || loadingOlder) return;
    const revision = ++requestRevision.current;
    const container = scrollContainer.current;
    if (container) scrollAdjustment.current = { height: container.scrollHeight, top: container.scrollTop };
    setLoadingOlder(true);
    setError(null);
    try {
      const older = await window.desktopApi.codexHistoryThreadMessages({
        threadId,
        cursor: page.nextCursor,
        pageSize: MESSAGE_PAGE_SIZE,
      });
      if (requestRevision.current !== revision) return;
      setPage((current) =>
        current && current.threadId === older.threadId
          ? {
              ...older,
              messages: mergedMessages(older.messages, current.messages),
              scanLimited: older.scanLimited || current.scanLimited,
            }
          : older,
      );
    } catch (reason) {
      if (requestRevision.current !== revision) return;
      scrollAdjustment.current = null;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (requestRevision.current === revision) setLoadingOlder(false);
    }
  }, [loadingOlder, page, threadId]);

  if (!item) return null;
  return (
    <aside className="flex min-w-0 flex-1 flex-col border-l">
      <header className="flex min-h-14 items-start gap-3 border-b px-4 py-3">
        <Button type="button" variant="ghost" size="sm" className="xl:hidden" onClick={onClose}>
          {l.usage.back}
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-5">{item.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
            <span>{dateFormatter.format(new Date(item.updatedAt))}</span>
            {page?.model && (
              <ModelIdentity providerKey={page.modelProvider ?? 'codex'} modelId={page.model} className="max-w-44" />
            )}
            {item.sectionName && <Badge variant="secondary">{item.sectionName}</Badge>}
            {item.projectName && <Badge variant="outline">{item.projectName}</Badge>}
            {item.archived && <Badge variant="outline">{l.navigation.archived}</Badge>}
            {item.source === 'SUBAGENT' && <Badge variant="outline">{l.subagent}</Badge>}
            {page?.scanLimited && <Badge variant="outline">{l.preview.partialHistory}</Badge>}
          </div>
        </div>
        <Button type="button" size="sm" onClick={() => onOpen(item.threadId)}>
          <ExternalLinkIcon className="size-3.5" />
          {l.preview.open}
        </Button>
      </header>
      <CodexHistoryThreadUsage key={item.threadId} threadId={item.threadId} updatedAt={item.updatedAt} />
      <div ref={scrollContainer} className="min-h-0 flex-1 overflow-y-auto">
        {page?.nextCursor != null && (
          <div className="flex justify-center border-b p-2">
            <Button type="button" variant="ghost" size="sm" disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? (
                <LoaderCircleIcon className="size-3.5 animate-spin" />
              ) : (
                <ChevronUpIcon className="size-3.5" />
              )}
              {l.preview.loadOlder}
            </Button>
          </div>
        )}
        {loading ? (
          <div className="grid min-h-40 place-items-center">
            <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : page?.messages.length ? (
          <div className="divide-y">
            {page.messages.map((message) => (
              <article key={message.messageId} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2.5 px-4 py-3">
                {message.role === 'USER' ? (
                  <span className="mt-0.5 grid size-7 place-items-center rounded-md bg-surface-sunken text-muted-foreground">
                    <UserIcon className="size-3.5" />
                  </span>
                ) : (
                  <ModelMark providerKey="openai" modelId={page.model ?? 'codex'} className="mt-0.5 size-7" />
                )}
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2 text-2xs text-muted-foreground">
                    <span
                      className="font-medium text-foreground"
                      title={
                        message.role === 'ASSISTANT' && page.model
                          ? `${page.modelProvider ?? 'openai'} · ${page.model}`
                          : undefined
                      }
                    >
                      {message.role === 'USER'
                        ? l.preview.user
                        : page.model
                          ? modelDisplayName(page.model)
                          : l.preview.assistant}
                    </span>
                    <time dateTime={message.createdAt}>{dateFormatter.format(new Date(message.createdAt))}</time>
                  </div>
                  <CodexHistoryMessageMarkdown text={message.text} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">{l.preview.noMessages}</div>
        )}
        {error && (
          <div role="alert" className="border-t px-4 py-3 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>
    </aside>
  );
}
