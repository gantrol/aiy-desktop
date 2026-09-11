import { useCallback, useState } from 'react';
import { Images } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { PetalNoteActions } from '@/renderer/features/desktop-petals/PetalNoteActions';
import { NoteAppearanceMenu } from '@/renderer/features/desktop-petals/NoteAppearanceMenu';
import type { PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import { NoteResizeHandle } from '@/renderer/features/desktop-petals/NoteResizeHandle';
import { CollapsedPetal } from '@/renderer/features/desktop-petals/CollapsedPetal';
import { appearanceStyle } from '@/renderer/features/desktop-petals/petal-appearance';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalErrorText } from '@/shared/petal-errors';
import { petalLabel } from '@/shared/petal-preview';
import type { DesktopPin } from '@/shared/contracts/petal-board';
import type { DesktopPetalSnapshot } from '@/shared/contracts/desktop-petals';
export function ContentPin({ pin, snapshot }: { pin: DesktopPin; snapshot: DesktopPetalSnapshot }) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals;
  const [error, setError] = useState('');
  const onError = useCallback((reason: unknown) => setError(String(reason)), []);
  const title = petalLabel(pin.title, pin.preview) || copy.board[pin.source.kind];
  const noteActions: PetalNoteMenuActions = {
    home: snapshot.home,
    alwaysOnTop: snapshot.alwaysOnTop,
    note: pin,
    board: snapshot.board,
    persisted: true,
    disabled: snapshot.suspended,
    onError,
    onAppearance: (patch) => window.desktopPetals.boardCommand({ kind: 'pin-appearance', id: pin.id, ...patch }),
  };
  if (!snapshot.expanded)
    return (
      <CollapsedPetal
        titlesVisible={snapshot.titlesVisible}
        color={pin.color}
        icon={pin.icon}
        label={title}
        title={title}
        onOpen={() => void window.desktopPetals.expand(true).catch(onError)}
        onError={onError}
        menuActions={{ ...noteActions, onExpand: () => window.desktopPetals.expand(true) }}
        anchor={snapshot.flowerAnchor}
        menuPreview={snapshot.flowerPreview}
      />
    );
  return (
    <section
      className="absolute inset-2 flex min-h-0 flex-col overflow-hidden rounded-md bg-[var(--petal-surface)] text-[var(--petal-ink)]"
      style={appearanceStyle(pin.color)}
    >
      <header className="flex shrink-0 cursor-move items-center gap-1 px-2 py-1 select-none [-webkit-app-region:drag]">
        <NoteAppearanceMenu {...noteActions} />
        <strong className="min-w-0 flex-1 truncate text-xs">{title}</strong>
        <PetalNoteActions {...noteActions} onCollapse={() => window.desktopPetals.expand(false)} />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {pin.mediaUrl ? (
          <Button
            variant="ghost"
            className="size-full p-0"
            aria-label={copy.board.open}
            onClick={() => void window.desktopPetals.openMain().catch(onError)}
          >
            <img
              src={pin.mediaUrl}
              alt={title}
              className="size-full object-contain"
              onError={() => setError('[aiy-petal:sourceUnavailable]')}
            />
          </Button>
        ) : pin.source.kind === 'ALBUM' || pin.source.kind === 'MATERIAL_ALBUM' ? (
          <Button
            variant="ghost"
            className="size-full"
            aria-label={copy.board.open}
            onClick={() => void window.desktopPetals.openMain().catch(onError)}
          >
            <Images className="size-12" />
          </Button>
        ) : (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed select-text">
            {pin.preview}
          </pre>
        )}
      </div>
      {error && (
        <div role="alert" className="px-3 py-1 text-xs text-destructive">
          {petalErrorText(error, copy.errors)}
        </div>
      )}
      <NoteResizeHandle disabled={snapshot.suspended} onError={onError} />
    </section>
  );
}
