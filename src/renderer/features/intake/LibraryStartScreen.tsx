import { useEffect, useState } from 'react';
import type { IntakeCommitResult, LegacyLocalSpaceCandidateDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ContentPackImportDialog } from '@/renderer/features/intake/ContentPackImportDialog';
import { GlobalDropOverlay } from '@/renderer/features/intake/GlobalDropOverlay';
import { IntakeActionBar } from '@/renderer/features/intake/IntakeActionBar';
import { IntakeDraftTray } from '@/renderer/features/intake/IntakeDraftTray';
import { IntakeProgressOverlay } from '@/renderer/features/intake/IntakeProgressOverlay';
import { IntakeSurface } from '@/renderer/features/intake/IntakeSurface';
import { StartActionBar } from '@/renderer/features/intake/StartActionBar';
import { StarterPackImportDialog } from '@/renderer/features/intake/StarterPackImportDialog';
import { isCreatorImageMimeType } from '@/renderer/features/intake/intakeImageFormats';
import { useIntakeController } from '@/renderer/features/intake/useIntakeController';
import { LegacySpaceMigrationDialog } from '@/renderer/components/spaces/LegacySpaceMigrationDialog';

interface Props {
  onCommitted(result: IntakeCommitResult): void;
  onContentPackImported(): Promise<void>;
  notify(message: string): void;
}

export function LibraryStartScreen({ onCommitted, onContentPackImported, notify }: Props) {
  const { messages } = useI18n();
  const l = messages.intake.start;
  const controller = useIntakeController('LIBRARY_START', onCommitted);
  const { state } = controller;
  const creationAvailable = state.items.every((item) => item.kind === 'TEXT' || isCreatorImageMimeType(item.mimeType));
  const [starterPackImportOpen, setStarterPackImportOpen] = useState(false);
  const [contentPackImportOpen, setContentPackImportOpen] = useState(false);
  const [openingLibrary, setOpeningLibrary] = useState(false);
  const [legacyMigrationOpen, setLegacyMigrationOpen] = useState(false);
  const [legacyCandidates, setLegacyCandidates] = useState<LegacyLocalSpaceCandidateDto[]>([]);

  useEffect(() => {
    let active = true;
    void window.desktopApi
      .localSpacesDiscoverLegacy()
      .then((candidates) => {
        if (!active) return;
        setLegacyCandidates(candidates);
        if (candidates.length) setLegacyMigrationOpen(true);
        else setStarterPackImportOpen(true);
      })
      .catch(() => {
        if (active) setStarterPackImportOpen(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const paste = (event: ClipboardEvent) => controller.onPaste(event);
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [controller]);

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && state.dragActive) controller.cancelDrag();
      else if (event.key === 'Escape' && state.items.length && !state.pendingIntent) controller.reset();
      if (
        event.key === 'Enter' &&
        state.items.length &&
        !state.pendingIntent &&
        !(event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]'))
      ) {
        event.preventDefault();
        void controller.commit(creationAvailable ? state.selectedIntent : 'IMPORT');
      }
    }
    window.addEventListener('keydown', keyDown);
    const blur = () => controller.cancelDrag();
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('blur', blur);
    };
  }, [controller, creationAvailable, state.dragActive, state.items.length, state.pendingIntent, state.selectedIntent]);

  async function openLibrary() {
    if (openingLibrary) return;
    setOpeningLibrary(true);
    try {
      const result = await window.desktopApi.localSpacesOpen();
      if (result.status === 'switched') return;
      setOpeningLibrary(false);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
      setOpeningLibrary(false);
    }
  }

  const pending = Boolean(state.pendingIntent);
  return (
    <IntakeSurface
      accessibleName={l.paste}
      data-intake-context="LIBRARY_START"
      data-intake-state={state.status}
      aria-busy={state.status === 'READING' || pending}
      className="relative flex size-full min-h-0 flex-col overflow-hidden bg-background"
      onDragEnter={controller.onDragEnter}
      onDragOver={controller.onDragOver}
      onDragLeave={controller.onDragLeave}
      onDrop={controller.onDrop}
    >
      {state.items.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-7">
          <span className="text-sm text-muted-foreground">{l.paste}</span>
          <StartActionBar
            chooseLabel={l.choose}
            contentPackLabel={l.contentPack}
            openLabel={l.open}
            openingLibrary={openingLibrary}
            reading={state.status === 'READING'}
            onChooseImages={controller.addFiles}
            onImportContentPack={() => setContentPackImportOpen(true)}
            onOpenLibrary={() => void openLibrary()}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col justify-center overflow-y-auto px-6 py-8">
          <IntakeDraftTray
            items={state.items}
            disabled={pending}
            onEditText={controller.editText}
            onMove={controller.move}
            onRemove={controller.remove}
          />
          {state.skipped.length > 0 && (
            <p className="mx-auto mt-3 w-full max-w-3xl text-xs text-muted-foreground">
              {messages.intake.review.skipped(state.skipped.length)}
            </p>
          )}
          {state.error && <p className="mx-auto mt-3 w-full max-w-3xl text-xs text-destructive">{state.error}</p>}
          <IntakeActionBar
            defaultIntent={state.defaultIntent}
            pendingIntent={state.pendingIntent}
            creationAvailable={creationAvailable}
            favorite={state.favorite}
            onFavoriteChange={controller.setFavorite}
            onStartCreation={() => void controller.commit('START_CREATION')}
            onImport={() => void controller.commit('IMPORT')}
            onCancel={controller.reset}
          />
        </div>
      )}
      <GlobalDropOverlay active={state.dragActive} label={l.paste} />
      <IntakeProgressOverlay active={state.status === 'READING'} label={messages.creator.workbench.importing} />
      <span className="sr-only" role="status" aria-live="polite">
        {state.status === 'READING'
          ? messages.creator.workbench.importing
          : state.status === 'COMMITTING_CREATE'
            ? messages.intake.actions.create
            : state.status === 'COMMITTING_IMPORT'
              ? messages.intake.actions.import
              : state.error}
      </span>
      <LegacySpaceMigrationDialog
        open={legacyMigrationOpen}
        candidates={legacyCandidates}
        onOpenChange={(next) => {
          setLegacyMigrationOpen(next);
          if (!next) setStarterPackImportOpen(true);
        }}
        onSwitched={() => setLegacyMigrationOpen(false)}
        notify={notify}
      />
      <StarterPackImportDialog
        open={starterPackImportOpen}
        onOpenChange={setStarterPackImportOpen}
        onImported={onContentPackImported}
        notify={notify}
      />
      <ContentPackImportDialog
        open={contentPackImportOpen}
        onOpenChange={setContentPackImportOpen}
        onImported={onContentPackImported}
        notify={notify}
      />
    </IntakeSurface>
  );
}
