import type { ResolvedContentReference } from '@/shared/contracts/content-library';
import type { ContentReferenceChanges } from '@/shared/contracts/content-reference-changes';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';

type Observer = {
  changed(value: ResolvedContentReference | undefined): void;
  failed(): void;
  lastValue?: string;
  sourceId?: string;
  spaceId?: string;
};
const observers = new Map<string, Set<Observer>>();
const dirty = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let pending = false;
let epoch = 0;
let transitioning = false;
let disconnect: (() => void) | undefined;

function schedule(delay = 5000) {
  if (timer || !observers.size || transitioning) return;
  timer = setTimeout(() => {
    timer = undefined;
    void refresh();
  }, delay);
}
function requestRefresh() {
  if (timer) clearTimeout(timer);
  timer = undefined;
  schedule(0);
}
function sourceChanged(event: ContentReferenceChanges) {
  const articles = event.articleIds ? new Set(event.articleIds) : null;
  for (const [id, listeners] of observers) {
    if (
      [...listeners].some(
        (listener) =>
          (!listener.spaceId || listener.spaceId === event.spaceId) &&
          (!articles || !listener.sourceId || articles.has(listener.sourceId)),
      )
    )
      dirty.add(id);
  }
  if (dirty.size) requestRefresh();
}
async function refresh() {
  if (pending || transitioning || !observers.size) return;
  if (document.visibilityState === 'hidden') {
    schedule();
    return;
  }
  pending = true;
  const generation = epoch;
  const ids = dirty.size ? [...dirty] : [...observers.keys()];
  ids.forEach((id) => dirty.delete(id));
  try {
    // One loop per renderer. Only current subscribers receive each batch, never a newly mounted replacement.
    for (let offset = 0; offset < ids.length && generation === epoch; offset += 100) {
      const batch = ids.slice(offset, offset + 100).filter((id) => observers.has(id));
      const receivers = new Map(batch.map((id) => [id, [...observers.get(id)!]]));
      if (!batch.length) continue;
      try {
        const rows = await contentLibraryApi().referenceResolve(batch);
        if (generation !== epoch) return;
        const byId = new Map(rows.map((row) => [row.reference.id, row]));
        // A save/visibility event during the request makes that read obsolete.
        // Leave it dirty for the next batch instead of displaying a stale value.
        notifyReceivers(new Map([...receivers].filter(([id]) => !dirty.has(id))), byId);
      } catch {
        if (generation !== epoch) return;
        failReceivers(new Map([...receivers].filter(([id]) => !dirty.has(id))));
      }
    }
  } finally {
    pending = false;
    schedule(dirty.size ? 0 : 5000);
  }
}
function visible() {
  if (document.visibilityState === 'hidden') return;
  for (const id of observers.keys()) dirty.add(id);
  requestRefresh();
}
function connect() {
  document.addEventListener('visibilitychange', visible);
  const changes = window.desktopApi?.onContentReferencesChanged?.(sourceChanged);
  // Restricted petals use their existing notifications and content capability;
  // they must not need (or receive) the main-window API just to render a reference.
  const petalChanges = !window.desktopApi ? window.desktopPetals?.onChanged?.(visible) : undefined;
  const petalSource = !window.desktopApi ? window.desktopPetals?.onSourceChanged?.(visible) : undefined;
  const transition = window.desktopApi?.onLocalSpaceTransition?.((event) => {
    epoch++;
    transitioning = event.phase === 'STARTING' || event.phase === 'PROGRESS';
    for (const [id, listeners] of observers) {
      dirty.add(id);
      for (const listener of listeners) {
        listener.lastValue = undefined;
        listener.changed(undefined);
      }
    }
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!transitioning) schedule(0);
  });
  disconnect = () => {
    changes?.();
    transition?.();
    petalChanges?.();
    petalSource?.();
    document.removeEventListener('visibilitychange', visible);
    transitioning = false;
  };
}
export function observeContentReference(id: string, observer: Observer) {
  if (!observers.size) connect();
  const listeners = observers.get(id) ?? new Set<Observer>();
  listeners.add(observer);
  observers.set(id, listeners);
  dirty.add(id);
  requestRefresh();
  let released = false;
  return () => {
    // A late repeated cleanup must not remove a new set of listeners for the same ID.
    if (released) return;
    released = true;
    listeners.delete(observer);
    if (!listeners.size) {
      observers.delete(id);
      dirty.delete(id);
    }
    if (!observers.size) {
      epoch++;
      if (timer) clearTimeout(timer);
      timer = undefined;
      disconnect?.();
      disconnect = undefined;
    }
  };
}

function notifyReceivers(receivers: Map<string, Observer[]>, byId: Map<string, ResolvedContentReference>) {
  for (const [id, listeners] of receivers) {
    const row = byId.get(id);
    const fingerprint = JSON.stringify(row ?? null);
    for (const receiver of listeners) {
      if (!observers.get(id)?.has(receiver) || receiver.lastValue === fingerprint) continue;
      receiver.lastValue = fingerprint;
      receiver.sourceId = row?.reference.source.id;
      receiver.spaceId = row?.reference.spaceId;
      receiver.changed(row);
    }
  }
}
function failReceivers(receivers: Map<string, Observer[]>) {
  for (const [id, listeners] of receivers)
    for (const receiver of listeners) {
      if (!observers.get(id)?.has(receiver)) continue;
      receiver.lastValue = undefined;
      receiver.failed();
    }
}
