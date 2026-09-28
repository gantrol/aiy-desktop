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
          className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex-col gap-0 touch-none rounded-none bg-transparent p-0 shadow-none hover:bg-transparent active:bg-transparent focus-visible:ring-inset focus-visible:ring-offset-0 ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{
            ...appearanceStyle(color),
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
