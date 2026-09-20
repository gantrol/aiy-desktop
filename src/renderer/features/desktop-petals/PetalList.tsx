import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Eye, EyeOff, PinOff, RefreshCw } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import { PetalManagerItem } from '@/renderer/features/desktop-petals/PetalManagerItem';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import type { PetalWorkspaceCommand } from '@/shared/contracts/petal-workspace';
import { usePetalWorkspace } from '@/renderer/features/desktop-petals/use-petal-workspace';

/** Selection only selects. Desktop placement changes through explicit commands. */
type Props = { snapshot: DesktopPetalSnapshot; onError(error: unknown): void };
export function PetalList(props: Props) {
  return <PetalManager key={props.snapshot.libraryId} {...props} />;
}
function PetalManager({ snapshot, onError }: Props) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals.contentEntry;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [layer, setLayer] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState(100);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [retry, setRetry] = useState(0);
  const { items, loading } = usePetalWorkspace(snapshot, onError, retry);
  const running = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const disabled = busy || snapshot.suspended;

  useEffect(() => {
    const ids = new Set(items.map((item) => item.id));
    setSelected((previous) => new Set([...previous].filter((id) => ids.has(id))));
  }, [items]);

  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return items.filter(
      (item) =>
        (layer === 'all' || item.layerId === layer) &&
        (filter === 'all' ||
          (filter === 'issues'
            ? !item.sourceAvailable || item.lastFlush?.report.status === 'blocked'
            : item.placement === filter)) &&
        (!term || `${item.title} ${item.sourceKind}`.toLocaleLowerCase().includes(term)),
    );
  }, [items, query, layer, filter]);
  const rows = visible.slice(0, limit);
  const changeFilter = (value: string) => {
    setFilter(value);
    setSelected(new Set());
    setLimit(100);
  };
  const run = async (command: Exclude<PetalWorkspaceCommand, { kind: 'list' }>) => {
    if (running.current || disabled) return;
    running.current = true;
    setBusy(true);
    setFeedback('');
    try {
      const result = await window.desktopPetals.workspaceAction(command);
      if (!mounted.current) return;
      setSelected((previous) => new Set([...previous].filter((id) => !result.completed.includes(id))));
      const failures = result.blocked.map(
        ({ id, reason }) => `${items.find((item) => item.id === id)?.title || copy.untitled}: ${copy.reasons[reason]}`,
      );
      setFeedback([`${copy.completed} ${result.completed.length}`, ...failures].join('\n'));
      setRetry((value) => value + 1);
    } catch (error) {
      if (mounted.current) {
        onError(error);
        setFeedback(copy.actionFailed);
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const global = async (action: 'restore' | 'temporaryHide') => {
    if (running.current || disabled) return;
    running.current = true;
    setBusy(true);
    setFeedback('');
    try {
      await (action === 'restore' ? window.desktopPetals.showAll() : window.desktopPetals.hideAll());
      if (!mounted.current) return;
      setRetry((value) => value + 1);
    } catch (error) {
      if (mounted.current) {
        onError(error);
        setFeedback(copy.actionFailed);
      }
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const select = (id: string, checked: boolean) => {
    if (checked && selected.size >= 200) {
      setFeedback(copy.selectionLimit);
      return;
    }
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const resetSearch = (value: string) => {
    setQuery(value);
    setSelected(new Set());
    setLimit(100);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" aria-busy={disabled || loading} data-slot="petal-manager">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input
          aria-label={copy.search}
          placeholder={copy.search}
          className="pl-9"
          value={query}
          onChange={(event) => resetSearch(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Select value={filter} onValueChange={changeFilter}>
          <SelectTrigger aria-label={copy.all} className="h-8 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(['all', 'active', 'temporary', 'collected', 'unplaced', 'issues'] as const).map((key) => (
              <SelectItem key={key} value={key}>
                {copy[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={layer}
          onValueChange={(value) => {
            setLayer(value);
            setSelected(new Set());
            setLimit(100);
          }}
        >
          <SelectTrigger aria-label={copy.allLayers} className="h-8 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{copy.allLayers}</SelectItem>
            {snapshot.board.layers.map((value) => (
              <SelectItem key={value.id} value={value.id}>
                {value.name || messages.desktopPetals.board.defaultLayer}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void global('restore')}>
          <Eye className="size-3.5" />
          {copy.restore}
        </Button>
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => void global('temporaryHide')}>
          <EyeOff className="size-3.5" />
          {copy.temporaryHide}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          title={copy.retry}
          aria-label={copy.retry}
          onClick={() => setRetry((value) => value + 1)}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-b pb-2 text-xs text-muted-foreground">
        <span className="mr-auto">
          {visible.length} {copy.entries} · {selected.size} {copy.selected}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || !rows.length}
          onClick={() => setSelected(new Set(rows.slice(0, 200).map((item) => item.id)))}
        >
          {copy.selectVisible}
        </Button>
        {selected.size > 0 && (
          <>
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setSelected(new Set())}>
              {copy.clearSelection}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => void run({ kind: 'collect', ids: [...selected] })}
            >
              <PinOff className="size-3.5" />
              {copy.collect}
            </Button>
          </>
        )}
      </div>
      {feedback && (
        <div role="status" className="max-h-24 shrink-0 overflow-y-auto whitespace-pre-wrap text-xs">
          {feedback}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto" role="list" aria-label={copy.all}>
        {rows.map((item) => (
          <PetalManagerItem
            key={item.id}
            item={item}
            layerName={snapshot.board.layers.find((value) => value.id === item.layerId)?.name}
            selected={selected.has(item.id)}
            disabled={disabled}
            onSelect={(checked) => select(item.id, checked)}
            onAction={(kind) => void run({ kind, id: item.id })}
          />
        ))}
        {!rows.length && (
          <p role="status" className="py-8 text-center text-sm text-muted-foreground">
            {loading ? copy.loading : copy.empty}
          </p>
        )}
        {visible.length > limit && (
          <Button variant="ghost" className="w-full" onClick={() => setLimit((value) => value + 100)}>
            {copy.more}
          </Button>
        )}
      </div>
    </div>
  );
}
