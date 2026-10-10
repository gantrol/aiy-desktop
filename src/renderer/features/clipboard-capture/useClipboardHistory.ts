import { useCallback, useEffect, useRef, useState } from 'react';
import {
  captureHistoryCommandSchema,
  clipboardCommandSchema,
  type CaptureHistoryCommand,
  type ClipboardCommand,
  type ClipboardEntry,
  type ClipboardStatus,
} from '@/shared/contracts/clipboard-capture';
import { useI18n } from '@/renderer/i18n/useI18n';

export type ClipboardFilter = 'all' | 'image' | 'text' | 'pinned';
export function useClipboardHistory(
  active: boolean,
  notify: (message: string) => void,
  includeHistory = true,
  scope: 'clipboard' | 'capture' = 'clipboard',
) {
  const l = useI18n().messages.clipboardCapture;
  const execute = useCallback(
    (command: ClipboardCommand | CaptureHistoryCommand) => {
      if (scope === 'capture' && command.kind !== 'capture' && command.kind !== 'cancelCapture') {
        return window.desktopApi.clipboardCapture.execute({
          kind: 'captureHistory',
          command: captureHistoryCommandSchema.parse(command),
        });
      }
      return window.desktopApi.clipboardCapture.execute(clipboardCommandSchema.parse(command));
    },
    [scope],
  );
  const [status, setStatus] = useState<ClipboardStatus | null>(null);
  const [items, setItems] = useState<ClipboardEntry[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ClipboardFilter>('all');
  const [offsets, setOffsets] = useState([0]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [selected, setSelected] = useState<ClipboardEntry | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [statusRevision, setStatusRevision] = useState(0);
  const pending = useRef(false);
  const selection = useRef(selected);
  selection.current = selected;
  const [hasUpdates, setHasUpdates] = useState(false);
  const offset = offsets[offsets.length - 1];
  const errorText = useCallback((code: string) => l.errors[code as keyof typeof l.errors] ?? l.errors.storage, [l]);
  const refresh = useCallback(() => {
    setHasUpdates(false);
    setRevision((value) => value + 1);
    setStatusRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = window.desktopApi.clipboardCapture.onChanged(() => {
      clearTimeout(timer);
      if (selection.current) {
        setHasUpdates(true);
        timer = setTimeout(() => setStatusRevision((value) => value + 1), 200);
      } else timer = setTimeout(refresh, 200);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [active, refresh]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    void execute({ kind: 'status' })
      .then((state) => {
        if (!current) return;
        if (state.kind === 'status') setStatus(state.value);
        else if (state.kind === 'error') setError(errorText(state.code));
      })
      .catch(() => {
        if (current) setError(l.errors.storage);
      });
    return () => {
      current = false;
    };
  }, [active, errorText, execute, l.errors.storage, statusRevision]);
  useEffect(() => {
    if (!active || !includeHistory) return;
    let current = true;
    const timer = setTimeout(() => {
      void execute({ kind: 'list', query, filter, offset })
        .then((page) => {
          if (!current) return;
          if (page?.kind === 'list') {
            setItems(page.items);
            setNextOffset(page.nextOffset);
            setSelected((old) => (old ? (page.items.find((item) => item.id === old.id) ?? null) : null));
          } else if (page?.kind === 'error' && page.code !== 'cancelled') setError(errorText(page.code));
        })
        .catch(() => {
          if (current) setError(l.errors.storage);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      current = false;
    };
  }, [active, errorText, execute, filter, includeHistory, l.errors.storage, offset, query, revision]);
  const run = async (command: ClipboardCommand | CaptureHistoryCommand) => {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await execute(command);
      if (result.kind === 'error') {
        setError(errorText(result.code));
        return false;
      }
      if (result.kind === 'status') setStatus(result.value);
      if (command.kind === 'copy') notify(l.copied);
      if (command.kind === 'material') notify(l.saved);
      if (command.kind === 'remove') setSelected(null);
      refresh();
      return true;
    } catch {
      setError(l.errors.storage);
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return {
    scope,
    execute,
    hasUpdates,
    status,
    items,
    query,
    filter,
    offsets,
    nextOffset,
    selected,
    error,
    busy,
    revision,
    errorText,
    refresh,
    run,
    setSelected,
    search: (value: string) => {
      setQuery(value);
      setOffsets([0]);
    },
    changeFilter: (value: ClipboardFilter) => {
      setFilter(value);
      setOffsets([0]);
    },
    previous: () => setOffsets((old) => (old.length > 1 ? old.slice(0, -1) : old)),
    next: () => {
      if (nextOffset !== null) setOffsets((old) => [...old, nextOffset]);
    },
  };
}
export type ClipboardHistoryController = ReturnType<typeof useClipboardHistory>;
