import { useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { petalErrorText } from '@/shared/petal-errors';
import type { NoteEditSession } from '@/renderer/features/desktop-petals/note-edit-session';

export function PetalNoteRecovery({
  session,
  state,
  appearanceError,
}: {
  session: NoteEditSession;
  state: ReturnType<NoteEditSession['getSnapshot']>;
  appearanceError: string;
}) {
  const copy = useI18n().messages.desktopPetals;
  const [comparing, setComparing] = useState(false);
  return (
    <>
      {state.status !== 'saved' && state.status !== 'saving' && state.status !== 'dirty' && (
        <div className="flex shrink-0 items-center gap-1 px-3 py-1 text-2xs" role="status">
          <span>{copy.note.unsaved}</span>
          <Button variant="ghost" size="xs" type="button" onClick={() => setComparing(!comparing)}>
            {copy.note.compare}
          </Button>
          <Button variant="ghost" size="xs" type="button" onClick={() => void session.flush()}>
            {copy.note.retry}
          </Button>
        </div>
      )}
      {(state.error || appearanceError) && (
        <p className="max-h-14 shrink-0 overflow-y-auto px-3 py-1 text-xs text-destructive" role="alert">
          {petalErrorText(appearanceError || state.error, copy.errors)}
        </p>
      )}
      {comparing && (
        <div className="absolute inset-x-2 bottom-2 top-10 flex flex-col gap-2 bg-[var(--petal-surface)] p-2 text-xs">
          <strong>{copy.note.savedContent}</strong>
          <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words font-sans select-text">
            {state.note.text || copy.note.blank}
          </pre>
          <div className="flex flex-wrap gap-1">
            <Button
              variant="ghost"
              size="xs"
              type="button"
              onClick={() => void session.keepMine().then((saved) => saved && setComparing(false))}
            >
              {copy.note.keepMine}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              type="button"
              onClick={() => void session.useSaved().then((saved) => saved && setComparing(false))}
            >
              {copy.note.useSaved}
            </Button>
            <Button variant="ghost" size="xs" type="button" onClick={() => setComparing(false)}>
              {copy.note.back}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
