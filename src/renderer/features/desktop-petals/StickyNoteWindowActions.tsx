import { NoteDisplayMenu } from '@/renderer/features/desktop-petals/NoteDisplayMenu';
import { PetalNoteActions } from '@/renderer/features/desktop-petals/PetalNoteActions';
import type { PetalNoteMenuActions } from '@/renderer/features/desktop-petals/PetalNoteMenu';
import { Minimize2, PanelsTopLeft } from 'lucide-react';
import { PetalIconButton } from '@/renderer/features/desktop-petals/PetalControls';
import { useI18n } from '@/renderer/i18n/useI18n';

export function StickyNoteWindowActions({
  actions,
  scale,
  fullWindow,
  applicationsVisible,
  hasApplications,
  onFullWindowChange,
  onApplicationsChange,
  onCollapse,
}: {
  actions: PetalNoteMenuActions;
  scale: number;
  fullWindow: boolean;
  applicationsVisible: boolean;
  hasApplications: boolean;
  onFullWindowChange(value: boolean): void;
  onApplicationsChange(value: boolean): void;
  onCollapse(): Promise<void>;
}) {
  const copy = useI18n().messages.desktopPetals;
  if (fullWindow)
    return (
      <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
        <PetalIconButton
          label={copy.display.exitFullWindow}
          disabled={actions.disabled}
          onClick={() => onFullWindowChange(false)}
        >
          <PanelsTopLeft />
        </PetalIconButton>
        <PetalIconButton
          label={copy.note.collapse}
          disabled={actions.disabled}
          onClick={() => void onCollapse().catch(actions.onError)}
        >
          <Minimize2 />
        </PetalIconButton>
      </div>
    );
  return (
    <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
      <NoteDisplayMenu
        scale={scale}
        actions={actions}
        fullWindow={fullWindow}
        onFullWindowChange={onFullWindowChange}
        applicationsVisible={applicationsVisible}
        onApplicationsChange={hasApplications ? onApplicationsChange : undefined}
      />
      <PetalNoteActions {...actions} onCollapse={onCollapse} />
    </div>
  );
}
