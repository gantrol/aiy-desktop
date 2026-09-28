import { useEffect, useRef, useState } from 'react';
import { Check, LoaderCircle, Pin } from 'lucide-react';
import { Input } from '@/renderer/components/ui/input';
import { Button } from '@/renderer/components/ui/button';
import { PetalPanel, PetalSelect, PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { useI18n } from '@/renderer/i18n/useI18n';
import { pinSourceSchema, type PinSource, type PinSummary } from '@/shared/contracts/petal-board';

export function PinSourcePicker({ onBack, onError }: { onBack: () => void; onError: (error: unknown) => void }) {
  const { messages, locale } = useI18n();
  const copy = messages.desktopPetals.board;
  const [kind, setKind] = useState<PinSource['kind']>('ARTICLE');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<{ key: string; items: PinSummary[]; failed: boolean } | null>(null);
  const [pinning, setPinning] = useState<string | null>(null);
  const [pinned, setPinned] = useState<Set<string>>(() => new Set());
  const running = useRef(false);
  const requestKey = JSON.stringify([kind, query, offset, locale, retry]);
  const settled = snapshot?.key === requestKey;
  const busy = !settled;
  const items = settled ? snapshot.items : [];
  const failed = settled && snapshot.failed;
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void window.desktopPetals
        .searchPinSources({ kind, query, offset, locale })
        .then((result) => {
          if (live) setSnapshot({ key: requestKey, items: result, failed: false });
        })
        .catch(() => {
          if (live) setSnapshot({ key: requestKey, items: [], failed: true });
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [kind, query, offset, locale, requestKey]);

  const pin = async (source: PinSource) => {
    if (running.current || busy) return;
    const key = `${source.kind}:${source.id}`;
    running.current = true;
    setPinning(key);
    try {
      await window.desktopPetals.boardCommand({ kind: 'pin', source });
      setPinned((current) => new Set(current).add(key));
    } catch (error) {
      onError(error);
    } finally {
      running.current = false;
      setPinning(null);
    }
  };
  return (
    <PetalPanel title={copy.pin} onBack={onBack}>
      <div className="mb-2 flex flex-col gap-2">
        <PetalSelect
          label={copy.sources}
          value={kind}
          options={pinSourceSchema.shape.kind.options.map((value) => ({ value, label: copy[value] }))}
          onChange={(value) => {
            setKind(value as PinSource['kind']);
            setOffset(0);
          }}
        />
        <Input
          aria-label={copy.search}
          placeholder={copy.search}
          value={query}
          maxLength={100}
          className="h-8"
          onChange={(event) => {
            setQuery(event.target.value);
            setOffset(0);
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={busy}>
        {busy && (
          <div role="status" className="flex items-center gap-2 py-3 text-xs">
            <LoaderCircle className="size-4 animate-spin" />
            {copy.loading}
          </div>
        )}
        {failed && (
          <div role="alert" className="space-y-2 py-3 text-xs">
            <span>{copy.failed}</span>
            <Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>
              {copy.retry}
            </Button>
          </div>
        )}
        {!busy && !failed && !items.length && (
          <div role="status" className="py-3 text-xs text-muted-foreground">
            {copy.empty}
          </div>
        )}
        {items.map((item) => {
          const key = `${item.source.kind}:${item.source.id}`;
          const done = pinned.has(key);
          const collection = item.source.kind === 'ALBUM' || item.source.kind === 'MATERIAL_ALBUM';
          return (
            <div key={key} className="flex min-w-0 items-center gap-2 border-b py-2">
              <span className="min-w-0 flex-1 text-xs">
                <span className="block truncate" title={item.title}>
                  {item.title || copy[item.source.kind]}
                </span>
                {item.parentPath && (
                  <span className="block truncate text-muted-foreground" title={item.parentPath}>
                    {item.parentPath}
                  </span>
                )}
              </span>
              <PetalIconButton
                label={done ? copy.pinned : collection ? copy.pinCollection : copy.pin}
                disabled={Boolean(pinning) || busy || done}
                onClick={() => void pin(item.source)}
              >
                {pinning === key ? <LoaderCircle className="animate-spin" /> : done ? <Check /> : <Pin />}
              </PetalIconButton>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between">
        <Button
          variant="ghost"
          size="xs"
          disabled={!offset || busy}
          onClick={() => setOffset((value) => Math.max(0, value - 30))}
        >
          {messages.desktopPetals.note.back}
        </Button>
        <Button
          variant="ghost"
          size="xs"
          disabled={items.length < 30 || busy || offset >= 9990}
          onClick={() => setOffset((value) => value + 30)}
        >
          {copy.more}
        </Button>
      </div>
    </PetalPanel>
  );
}
