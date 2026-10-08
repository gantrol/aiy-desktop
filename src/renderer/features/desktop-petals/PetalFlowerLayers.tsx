import { Button } from '@/renderer/components/ui/button';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import type { PetalBoardCommand } from '@/shared/contracts/petal-board';

export function PetalFlowerLayers({
  snapshot,
  fold,
  onCommand,
}: {
  snapshot: DesktopPetalSnapshot;
  fold: number;
  onCommand(command: PetalBoardCommand): void;
}) {
  const copy = useI18n().messages.desktopPetals;
  const board = snapshot.board;
  if (board.layers.length <= 1) return null;
  return board.layers.map((layer, index) => {
    const angle = ((-90 + (index * 360) / board.layers.length) * Math.PI) / 180;
    const radius = snapshot.hubSettings.flowerSize / 2 + 10;
    const selected = board.activeLayerId === layer.id;
    const hidden = board.hiddenLayerIds.includes(layer.id);
    return (
      <Button
        disabled={fold > 0}
        key={layer.id}
        variant="ghost"
        className="absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full p-1"
        style={{
          opacity: Math.max(0, 1 - fold * 5),
          ...appearanceStyle(layer.color),
          left: snapshot.hubSettings.flowerSize / 2 + Math.cos(angle) * radius,
          top: snapshot.hubSettings.flowerSize / 2 + Math.sin(angle) * radius,
        }}
        title={layer.name || copy.board.defaultLayer}
        aria-label={layer.name || copy.board.defaultLayer}
        aria-pressed={!hidden}
        onClick={() => onCommand({ kind: selected && !hidden ? 'toggle-layer' : 'select-layer', id: layer.id })}
      >
        <span
          className={`size-2 rounded-full border border-[var(--petal-edge)] ${hidden ? 'bg-transparent' : 'bg-[var(--petal-edge)]'} ${selected ? 'outline outline-1 outline-offset-2 outline-[var(--petal-edge)]' : ''}`}
        />
      </Button>
    );
  });
}
