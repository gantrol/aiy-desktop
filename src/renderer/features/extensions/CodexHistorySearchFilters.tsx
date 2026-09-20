import { useState } from 'react';
import {
  CheckIcon,
  ChevronsUpDownIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from 'lucide-react';
import type { CodexHistoryThreadOption } from '@/shared/contracts';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/renderer/components/ui/command';
import { Input } from '@/renderer/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { CodexUsageDateRangePicker } from '@/renderer/features/extensions/CodexUsageDateRangePicker';
import type { useCodexHistorySearch } from '@/renderer/features/extensions/useCodexHistorySearch';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

type HistorySearchState = ReturnType<typeof useCodexHistorySearch>;

interface SessionFilterProps {
  disabled: boolean;
  loading: boolean;
  selected: CodexHistoryThreadOption | null;
  options: CodexHistoryThreadOption[];
  query: string;
  onQueryChange(query: string): void;
  onSelect(thread: CodexHistoryThreadOption | null): void;
}

function SessionFilter({ disabled, loading, selected, options, query, onQueryChange, onSelect }: SessionFilterProps) {
  const l = useI18n().messages.extensions.codexHistorySearch;
  const [open, setOpen] = useState(false);

  return (
    <Popover
      modal
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) onQueryChange('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          role="combobox"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={l.filters.session}
          aria-expanded={open}
          className="min-w-44 max-w-72 justify-start font-normal data-[state=open]:bg-hover"
        >
          <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.title ?? l.filters.allSessions}
          </span>
          {loading ? (
            <LoaderCircleIcon className="ml-auto size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <ChevronsUpDownIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-80 p-0">
        <Command label={l.filters.session} shouldFilter={false}>
          <CommandInput value={query} placeholder={l.filters.searchSessions} onValueChange={onQueryChange} />
          <CommandList ariaLabel={l.filters.session}>
            <CommandEmpty>
              {loading ? <LoaderCircleIcon className="mx-auto size-4 animate-spin" /> : l.filters.noSessions}
            </CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__all_sessions__"
                data-current={!selected || undefined}
                className={
                  !selected ? 'bg-selected text-selected-foreground data-[selected=true]:bg-selected' : undefined
                }
                onSelect={() => {
                  onSelect(null);
                  setOpen(false);
                }}
              >
                <CheckIcon className={cn('size-3.5 shrink-0', selected && 'invisible')} />
                {l.filters.allSessions}
              </CommandItem>
              {options.map((thread) => (
                <CommandItem
                  key={thread.threadId}
                  value={thread.threadId}
                  data-current={thread.threadId === selected?.threadId || undefined}
                  className={
                    thread.threadId === selected?.threadId
                      ? 'bg-selected text-selected-foreground data-[selected=true]:bg-selected'
                      : undefined
                  }
                  onSelect={() => {
                    onSelect(thread);
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    className={cn('size-3.5 shrink-0', thread.threadId !== selected?.threadId && 'invisible')}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{thread.title}</span>
                    {(thread.projectName || thread.workspace) && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {thread.projectName || thread.workspace}
                      </span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AdvancedFilters({ state }: { state: HistorySearchState }) {
  const l = useI18n().messages.extensions.codexHistorySearch;
  const activeCount =
    Number(state.archive !== 'ALL') +
    Number(state.role !== 'ALL') +
    Number(state.includeSubagents) +
    Number(Boolean(state.workspace)) +
    Number(Boolean(state.branch));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="font-normal data-[state=open]:bg-hover">
          <SlidersHorizontalIcon className="size-4 text-muted-foreground" />
          {l.filters.more}
          {activeCount > 0 && <Badge variant="secondary">{activeCount}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-80 p-3">
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <span className="text-xs font-medium">{l.filters.archive}</span>
            <Segmented
              type="single"
              value={state.archive}
              aria-label={l.filters.archive}
              className="grid h-auto grid-cols-3"
              onValueChange={(value) => value && state.setArchive(value as typeof state.archive)}
            >
              <SegmentedItem value="ALL" className="px-1 text-xs">
                {l.archive.ALL}
              </SegmentedItem>
              <SegmentedItem value="ACTIVE" className="px-1 text-xs">
                {l.archive.ACTIVE}
              </SegmentedItem>
              <SegmentedItem value="ARCHIVED" className="px-1 text-xs">
                {l.archive.ARCHIVED}
              </SegmentedItem>
            </Segmented>
          </div>
          <label className="grid gap-1.5 text-xs font-medium">
            {l.filters.role}
            <Select
              disabled={state.scope === 'THREADS'}
              value={state.role}
              onValueChange={(value) => state.setRole(value as typeof state.role)}
            >
              <SelectTrigger className="w-full font-normal" aria-label={l.filters.role}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{l.roles.ALL}</SelectItem>
                <SelectItem value="USER">{l.roles.USER}</SelectItem>
                <SelectItem value="ASSISTANT">{l.roles.ASSISTANT}</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {l.filters.workspace}
            <Input
              value={state.workspace}
              className="font-normal"
              placeholder={l.filters.workspacePlaceholder}
              onChange={(event) => state.setWorkspace(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-xs font-medium">
            {l.filters.branch}
            <Input
              value={state.branch}
              className="font-normal"
              placeholder={l.filters.branchPlaceholder}
              onChange={(event) => state.setBranch(event.target.value)}
            />
          </label>
          <label className="flex h-9 items-center gap-2 text-xs font-medium">
            <Checkbox
              checked={state.includeSubagents}
              onCheckedChange={(checked) => state.setIncludeSubagents(checked === true)}
            />
            {l.filters.subagents}
          </label>
          <div className="flex justify-end border-t pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!activeCount}
              onClick={state.resetAdvancedFilters}
            >
              {l.actions.clearFilters}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CodexHistorySearchFilters({ authorized, state }: { authorized: boolean; state: HistorySearchState }) {
  const l = useI18n().messages.extensions.codexHistorySearch;

  return (
    <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2.5">
      <div className="relative min-w-52 flex-1">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={state.draftQuery}
          role="searchbox"
          maxLength={500}
          className="pl-9 pr-9"
          placeholder={l.searchPlaceholder}
          aria-label={l.searchLabel}
          onChange={(event) => state.setDraftQuery(event.target.value)}
          onCompositionStart={() => state.setQueryComposing(true)}
          onCompositionEnd={() => state.setQueryComposing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
              event.preventDefault();
              state.setDraftQuery('');
            }
          }}
        />
        {state.draftQuery && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute right-0.5 top-0.5"
            aria-label={l.actions.clearSearch}
            title={l.actions.clearSearch}
            onClick={() => state.setDraftQuery('')}
          >
            <XIcon className="size-3.5" />
          </Button>
        )}
      </div>
      <Select value={state.scope} onValueChange={(value) => state.setScope(value as typeof state.scope)}>
        <SelectTrigger className="w-32" aria-label={l.filters.scope}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ALL">{l.scopes.ALL}</SelectItem>
          <SelectItem value="THREADS">{l.scopes.THREADS}</SelectItem>
          <SelectItem value="MESSAGES">{l.scopes.MESSAGES}</SelectItem>
        </SelectContent>
      </Select>
      <SessionFilter
        disabled={!authorized}
        loading={state.filtersLoading}
        selected={state.selectedThread}
        options={state.filterOptions.threads}
        query={state.threadQuery}
        onQueryChange={state.setThreadQuery}
        onSelect={state.selectThread}
      />
      <CodexUsageDateRangePicker
        disabled={!authorized}
        label={l.filters.date}
        range={state.range}
        dateRange={state.dateRange}
        onChange={state.setDateSelection}
      />
      <AdvancedFilters state={state} />
    </div>
  );
}
