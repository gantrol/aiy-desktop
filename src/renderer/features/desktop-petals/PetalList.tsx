import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Button } from '@/renderer/components/ui/button';
import { EyeOff } from 'lucide-react';
import { PetalNoteIcon } from '@/renderer/features/desktop-petals/petal-appearance';
export function PetalList({ snapshot, onError }: { snapshot: DesktopPetalSnapshot; onError(error: unknown): void }) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals,
    board = snapshot.board;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {[...snapshot.notes, ...board.pins].map((note) => (
        <div key={note.id} className="flex items-center gap-1">
          <Checkbox
            checked={snapshot.placements[note.id]?.visible !== false}
            aria-label={`${copy.drawer.selected} · ${('displayTitle' in note ? note.displayTitle : note.title) || copy.note.title}`}
            onCheckedChange={(value) =>
              void window.desktopPetals
                .drawer({ kind: 'visibility', id: note.id, visible: value === true })
                .catch(onError)
            }
          />
          <Button
            variant="ghost"
            size="sm"
            className="my-0.5 min-w-0 flex-1 justify-start gap-2"
            disabled={board.hiddenLayerIds.includes(board.memberships[note.id] ?? 'default')}
            onClick={() => void window.desktopPetals.open(note.id).catch(onError)}
          >
            <PetalNoteIcon icon={note.icon} className="size-4 shrink-0" />
            <span className="truncate">
              {('displayTitle' in note ? note.displayTitle : note.title) || copy.note.title}
            </span>
          </Button>
          {board.hiddenLayerIds.includes(board.memberships[note.id] ?? 'default') && (
            <EyeOff className="size-3 shrink-0" aria-label={copy.drawer.hiddenLayer} />
          )}
        </div>
      ))}
    </div>
  );
}
