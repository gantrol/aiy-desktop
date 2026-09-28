import type { ComponentProps, ReactNode } from 'react';
import { ALargeSmall } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { ContentAlbumSelect } from '@/renderer/features/content-editor/ContentAlbumSelect';
import { PetalReferenceAdd } from '@/renderer/features/desktop-petals/PetalReferences';
import type { NoteEditSession } from '@/renderer/features/desktop-petals/note-edit-session';
import { useI18n } from '@/renderer/i18n/useI18n';

/** Source editing tools stay separate from device-local window/display controls. */
export function StickyNoteFooter({
  session,
  state,
  closing,
  formatting,
  onToggleFormatting,
  onReferences,
  onAddFiles,
  onError,
  applications,
  actions,
  fullWindow,
}: {
  session: NoteEditSession;
  state: ReturnType<NoteEditSession['getSnapshot']>;
  closing: boolean;
  formatting: boolean;
  onToggleFormatting(): void;
  onReferences: ComponentProps<typeof PetalReferenceAdd>['onChange'];
  onAddFiles(): void;
  onError(reason: unknown): void;
  applications?: ReactNode;
  actions?: ReactNode;
  fullWindow: boolean;
}) {
  const copy = useI18n().messages.desktopPetals;
  return (
    <footer
      className={`flex shrink-0 items-center gap-0.5 pl-3 pr-8 py-1.5 ${fullWindow ? 'cursor-move [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]' : ''}`}
    >
      <ContentAlbumSelect
        defaultWhenUnassigned={!state.note.persisted}
        albumId={state.note.albumId}
        disabled={state.frozen || closing}
        onError={onError}
        onChange={async (albumId) => {
          if (!(await session.flush())) throw new Error(copy.note.unsaved);
          session.receive(await window.desktopPetals.setAlbum({ id: state.note.id, albumId }));
        }}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-inherit"
        aria-label={copy.document.format}
        title={copy.document.format}
        aria-pressed={formatting}
        disabled={state.frozen || closing || !state.note.editable}
        onClick={onToggleFormatting}
      >
        <ALargeSmall className="size-4" />
      </Button>
      <PetalReferenceAdd
        note={state.note}
        disabled={state.frozen || !state.note.editable || closing}
        onChange={onReferences}
        onError={onError}
        onAddFiles={onAddFiles}
      />
      {applications}
      <div className="min-w-3 flex-1" />
      {actions}
    </footer>
  );
}
