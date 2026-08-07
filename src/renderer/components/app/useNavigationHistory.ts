import { useCallback, useState } from 'react';

type NavigationDestination<Value> = Value | ((current: Value) => Value);

interface NavigationHistory<Value> {
  entries: Value[];
  index: number;
}

const MAX_HISTORY_ENTRIES = 100;

export function useNavigationHistory<Value>(
  initialEntry: Value,
  isSameEntry: (left: Value, right: Value) => boolean = Object.is,
) {
  const [history, setHistory] = useState<NavigationHistory<Value>>({
    entries: [initialEntry],
    index: 0,
  });

  const navigate = useCallback(
    (destination: NavigationDestination<Value>) => {
      setHistory((current) => {
        const currentEntry = current.entries[current.index];
        const nextEntry =
          typeof destination === 'function' ? (destination as (entry: Value) => Value)(currentEntry) : destination;
        if (isSameEntry(currentEntry, nextEntry)) return current;

        const entries = [...current.entries.slice(0, current.index + 1), nextEntry];
        const retainedEntries = entries.slice(-MAX_HISTORY_ENTRIES);
        return { entries: retainedEntries, index: retainedEntries.length - 1 };
      });
    },
    [isSameEntry],
  );

  const replace = useCallback(
    (destination: NavigationDestination<Value>) => {
      setHistory((current) => {
        const currentEntry = current.entries[current.index];
        const nextEntry =
          typeof destination === 'function' ? (destination as (entry: Value) => Value)(currentEntry) : destination;
        if (isSameEntry(currentEntry, nextEntry)) return current;
        if (current.index > 0 && isSameEntry(current.entries[current.index - 1], nextEntry)) {
          return {
            entries: current.entries.slice(0, current.index),
            index: current.index - 1,
          };
        }

        const entries = [...current.entries];
        entries[current.index] = nextEntry;
        return { ...current, entries };
      });
    },
    [isSameEntry],
  );

  const goBack = useCallback(() => {
    setHistory((current) => (current.index > 0 ? { ...current, index: current.index - 1 } : current));
  }, []);

  const goForward = useCallback(() => {
    setHistory((current) =>
      current.index < current.entries.length - 1 ? { ...current, index: current.index + 1 } : current,
    );
  }, []);

  return {
    current: history.entries[history.index],
    navigate,
    replace,
    goBack,
    goForward,
    canGoBack: history.index > 0,
    canGoForward: history.index < history.entries.length - 1,
  };
}
