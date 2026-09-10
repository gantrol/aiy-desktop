import { useState } from 'react';
import { Eye, EyeOff, Plus, Pencil, X, Check } from 'lucide-react';
import { Input } from '@/renderer/components/ui/input';
import { Button } from '@/renderer/components/ui/button';
import { PetalIconButton, PetalPanel } from '@/renderer/features/desktop-petals/PetalControls';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { PetalBoard, PetalBoardCommand } from '@/shared/contracts/petal-board';
export function PetalLayers({
  board,
  onBack,
  onCommand,
}: {
  board: PetalBoard;
  onBack: () => void;
  onCommand: (command: PetalBoardCommand) => Promise<void>;
}) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals.board;
  const [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(''),
    [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onCommand(
        editing === 'new' ? { kind: 'create-layer', name } : { kind: 'rename-layer', id: editing!, name },
      );
      setEditing(null);
    } finally {
      setBusy(false);
    }
  };
  return (
    <PetalPanel
      title={copy.title}
      onBack={onBack}
      actions={
        <PetalIconButton
          label={copy.addLayer}
          disabled={board.layers.length >= 8}
          onClick={() => {
            setEditing('new');
            setName('');
          }}
        >
          <Plus />
        </PetalIconButton>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {editing && (
          <form
            className="mb-2 flex gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              void save().catch(() => undefined);
            }}
          >
            <Input
              aria-label={copy.layerName}
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              className="h-8 min-w-0"
            />
            <PetalIconButton label={copy.save} type="submit" disabled={busy || !name.trim()}>
              <Check />
            </PetalIconButton>
            <PetalIconButton label={messages.desktopPetals.note.back} onClick={() => setEditing(null)}>
              <X />
            </PetalIconButton>
          </form>
        )}
        {board.layers.map((layer) => (
          <div key={layer.id} className="flex items-center gap-1 py-1">
            <PetalIconButton
              label={board.hiddenLayerIds.includes(layer.id) ? copy.showLayer : copy.hideLayer}
              onClick={() => void onCommand({ kind: 'toggle-layer', id: layer.id }).catch(() => undefined)}
            >
              {board.hiddenLayerIds.includes(layer.id) ? <EyeOff /> : <Eye />}
            </PetalIconButton>
            <Button
              variant={board.activeLayerId === layer.id ? 'secondary' : 'ghost'}
              size="sm"
              className="min-w-0 flex-1 justify-start truncate"
              onClick={() => void onCommand({ kind: 'select-layer', id: layer.id }).catch(() => undefined)}
            >
              {layer.name || copy.defaultLayer}
            </Button>
            <PetalIconButton
              label={copy.renameLayer}
              onClick={() => {
                setEditing(layer.id);
                setName(layer.name);
              }}
            >
              <Pencil />
            </PetalIconButton>
            <PetalIconButton
              label={copy.removeLayer}
              disabled={layer.id === 'default'}
              onClick={() => void onCommand({ kind: 'remove-layer', id: layer.id }).catch(() => undefined)}
            >
              <X />
            </PetalIconButton>
          </div>
        ))}
      </div>
    </PetalPanel>
  );
}
