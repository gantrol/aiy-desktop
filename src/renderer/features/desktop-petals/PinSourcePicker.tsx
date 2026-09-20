import { useEffect, useState } from 'react';
import { Pin } from 'lucide-react';
import { Input } from '@/renderer/components/ui/input';
import { Button } from '@/renderer/components/ui/button';
import { PetalPanel, PetalSelect, PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { useI18n } from '@/renderer/i18n/useI18n';
import { pinSourceSchema, type PinSource, type PinSummary } from '@/shared/contracts/petal-board';

export function PinSourcePicker({ onBack, onError }: { onBack: () => void; onError: (error: unknown) => void }) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals.board;
  const labels = copy;
  const [kind, setKind] = useState<PinSource['kind']>('ARTICLE');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<PinSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [pinning, setPinning] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setBusy(true);
      void window.desktopPetals
        .searchPinSources({ kind, query, offset })
        .then((result) => {
          if (live) setItems(result);
        })
        .catch((error) => {
          if (live) onError(error);
        })
        .finally(() => {
          if (live) setBusy(false);
        });
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [kind, query, offset, onError]);
  const pin = async (source: PinSource) => {
    if (pinning) return;
    setPinning(source.id);
    try {
      await window.desktopPetals.boardCommand({ kind: 'pin', source });
    } catch (error) {
      onError(error);
    } finally {
      setPinning(null);
    }
  };
  return (
    <PetalPanel title={copy.pin} onBack={onBack}>
      <div className="mb-2 flex flex-col gap-2">
        <PetalSelect
          label={copy.sources}
          value={kind}
          options={pinSourceSchema.shape.kind.options.map((value) => ({ value, label: labels[value] }))}
          onChange={(value) => {
            setKind(value as PinSource['kind']);
            setOffset(0);
            setItems([]);
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
            setItems([]);
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={busy}>
        {items.map((item) => (
          <div key={`${item.source.kind}:${item.source.id}`} className="flex min-w-0 items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1 truncate text-xs" title={item.title}>
              {item.title || labels[item.source.kind]}
            </span>
            <PetalIconButton label={copy.pin} disabled={Boolean(pinning) || busy} onClick={() => void pin(item.source)}>
              <Pin />
            </PetalIconButton>
          </div>
        ))}
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
