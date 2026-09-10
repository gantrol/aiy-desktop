import { Button } from '@/renderer/components/ui/button';
import { PetalShape, type PetalSignal } from '@/renderer/features/desktop-petals/PetalShape';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { usePetalDrag } from '@/renderer/features/desktop-petals/use-petal-drag';
import { PetalNoteContextMenu } from '@/renderer/features/desktop-petals/PetalNoteContextMenu';
import type { PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import type { PetalColor, PetalIcon } from '@/shared/contracts/desktop-petals';
import { PETAL_WINDOW_SIZES } from '@/shared/contracts/petal-hub';
import { PetalCaption } from '@/renderer/features/desktop-petals/PetalCaption';
import { PetalPreview } from '@/renderer/features/desktop-petals/PetalPreview';
import { PETAL_SHAPE_LAYOUT } from '@/renderer/features/desktop-petals/petal-shape-layout';

export function CollapsedPetal({
  color,
  icon,
  label,
  title,
  titlesVisible,
  signal,
  onOpen,
  onError,
  menuActions,
  anchor,
  menuPreview,
}: {
  color: PetalColor;
  icon: PetalIcon;
  label: string;
  title: string;
  titlesVisible: boolean;
  signal?: PetalSignal;
  onOpen(): void;
  onError(reason: unknown): void;
  menuActions: PetalNoteMenuActions;
  anchor: { x: number; y: number };
  menuPreview: boolean;
}) {
  const { dragging, handlers } = usePetalDrag(menuPreview ? undefined : onOpen, onError);
  return (
    <PetalNoteContextMenu {...menuActions} disabled={menuActions.disabled || dragging}>
      <PetalPreview
        id={menuActions.note.id}
        title={title}
        disabled={menuActions.disabled || dragging || menuPreview}
        onError={onError}
      >
        <Button
          data-action="open-petal"
          data-petal-id={menuActions.note.id}
          variant="ghost"
          type="button"
          className={`absolute flex-col gap-0 touch-none rounded-none bg-transparent p-0 shadow-none hover:bg-transparent active:bg-transparent focus-visible:ring-inset focus-visible:ring-offset-0 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{
            ...appearanceStyle(color),
            left: anchor.x - PETAL_WINDOW_SIZES.collapsed.width / 2 + 5,
            top: anchor.y - PETAL_WINDOW_SIZES.collapsed.height / 2 + 5,
            width: PETAL_WINDOW_SIZES.collapsed.width - 10,
            height: PETAL_WINDOW_SIZES.collapsed.height - 10,
          }}
          aria-label={signal ? `${label} · ${signal.label}` : label}
          {...(!menuPreview ? handlers : {})}
        >
          <span
            className="pointer-events-none relative block shrink-0"
            style={{ width: PETAL_SHAPE_LAYOUT.width, height: PETAL_SHAPE_LAYOUT.height }}
          >
            <PetalShape icon={icon} signal={signal} />
          </span>
          <PetalCaption title={title} visible={titlesVisible} />
        </Button>
      </PetalPreview>
    </PetalNoteContextMenu>
  );
}
