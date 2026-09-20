import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftIcon, ExternalLinkIcon, SearchIcon, XIcon } from 'lucide-react';
import type { CodexHistoryRoleFilter, CodexHistorySearchResult } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { ModelIdentity } from '@/renderer/components/model/ModelIdentity';
import { CodexHistoryMessageList } from '@/renderer/features/extensions/CodexHistoryMessageList';
import { CodexHistoryHighlightedText } from '@/renderer/features/extensions/CodexHistoryHighlightedText';
import { CodexHistoryThreadUsage } from '@/renderer/features/extensions/CodexHistoryThreadUsage';
import { useCodexHistoryMessages } from '@/renderer/features/extensions/useCodexHistoryMessages';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  item: CodexHistorySearchResult | null;
  locale: string;
  initialQuery: string;
  initialRole: CodexHistoryRoleFilter;
  onOpen(threadId: string): void;
  onClose(): void;
}

function HistoryThreadPane({
  item,
  locale,
  initialQuery,
  initialRole,
  onOpen,
  onClose,
}: Props & { item: CodexHistorySearchResult }) {
  const l = useI18n().messages.extensions.codexHistorySearch;
  const [draftQuery, setDraftQuery] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [role, setRole] = useState(initialRole);
  const [composing, setComposing] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const state = useCodexHistoryMessages(item.threadId, query, role);
  const { page } = state;
  const pendingQuery = draftQuery.trim() !== query;
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );

  useEffect(() => {
    setDraftQuery(initialQuery);
    setQuery(initialQuery);
    setRole(initialRole);
  }, [initialQuery, initialRole]);
  useEffect(() => {
    if (composing) return;
    const timer = window.setTimeout(() => setQuery(draftQuery.trim()), 140);
    return () => window.clearTimeout(timer);
  }, [draftQuery, composing]);
  useEffect(() => {
    const find = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', find);
    return () => window.removeEventListener('keydown', find);
  }, []);

  const clear = () => {
    setDraftQuery('');
    setQuery('');
    setRole('ALL');
    inputRef.current?.focus();
  };

  return (
    <aside
      className="flex min-w-0 flex-1 flex-col border-l"
      aria-label={l.preview.conversation}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        if (state.anchor) state.backToResults();
        else clear();
      }}
    >
      <header className="flex min-h-14 items-start gap-3 border-b px-4 py-3">
        <Button type="button" variant="ghost" size="sm" className="xl:hidden" onClick={onClose}>
          {l.usage.back}
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-semibold leading-5">
            <CodexHistoryHighlightedText text={item.title} query={initialQuery} />
          </h3>
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
      <CodexHistoryThreadUsage threadId={item.threadId} updatedAt={item.updatedAt} />
      <div
        role="search"
        aria-label={l.preview.searchLabel}
        className="flex flex-wrap items-center gap-2 border-b px-3 py-2"
      >
        <div className="relative min-w-36 flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={draftQuery}
            maxLength={500}
            className="h-8 pl-8 pr-8 text-xs"
            aria-label={l.preview.searchLabel}
            placeholder={l.preview.searchPlaceholder}
            onChange={(event) => setDraftQuery(event.target.value)}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
          />
          {draftQuery && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute right-0 top-0"
              aria-label={l.actions.clearSearch}
              title={l.actions.clearSearch}
              onClick={() => {
                setDraftQuery('');
                setQuery('');
                inputRef.current?.focus();
              }}
            >
              <XIcon className="size-3.5" />
            </Button>
          )}
        </div>
        <Select value={role} onValueChange={(value) => setRole(value as CodexHistoryRoleFilter)}>
          <SelectTrigger className="h-8 w-28 text-xs" aria-label={l.filters.role}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['ALL', 'USER', 'ASSISTANT'] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {l.roles[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {(state.filtered || state.anchor) && (
        <div className="flex min-h-9 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
          {state.anchor ? (
            <Button type="button" variant="ghost" size="xs" onClick={state.backToResults}>
              <ArrowLeftIcon className="size-3.5" />
              {l.preview.backToResults}
            </Button>
          ) : (
            <span role="status">
              {state.loading || pendingQuery
                ? l.preview.searching
                : l.preview.messageMatches(page?.messages.length ?? 0) + (page?.nextCursor != null ? '+' : '')}
            </span>
          )}
          <Button type="button" variant="ghost" size="xs" className="ml-auto" onClick={clear}>
            {l.preview.allMessages}
          </Button>
        </div>
      )}
      <CodexHistoryMessageList
        state={state}
        query={query}
        pendingQuery={pendingQuery}
        dateFormatter={dateFormatter}
        onOpenThread={onOpen}
      />
    </aside>
  );
}

export function CodexHistoryThreadDetail(props: Props) {
  return props.item ? <HistoryThreadPane key={props.item.threadId} {...props} item={props.item} /> : null;
}
