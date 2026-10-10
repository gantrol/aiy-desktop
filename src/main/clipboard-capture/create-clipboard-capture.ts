import type { BrowserWindow } from 'electron';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { DesktopPetalsController } from '@/main/desktop-petals/desktop-petals-controller';
import { ClipboardCaptureService } from '@/main/clipboard-capture/service';

/** Coordinates shutdown with the existing temporary-content owner. */
export function createClipboardCapture(
  shell: {
    mainWindow: BrowserWindow | null;
    activeLibraryContext: ActiveLibraryContext | null;
    getLanguage(): { locale: string };
  },
  petals: DesktopPetalsController,
  allowPresentation: boolean,
) {
  const service = new ClipboardCaptureService({
    main: () => shell.mainWindow,
    context: () => shell.activeLibraryContext,
    allowPresentation,
    locale: () => shell.getLanguage().locale,
    openTemporary: petals.acceptClipboardSnapshot.bind(petals),
  });
  return {
    get canCapture() {
      return service.canCapture;
    },
    get canOpenHistory() {
      return service.canOpenHistory;
    },
    openHistory: async () => {
      try {
        await service.openHistory();
      } catch {
        // Library changes and shutdown can invalidate a tray action after it was shown.
      }
    },
    capture: () => service.startCapture(),
    activate: (context: ActiveLibraryContext) => service.activate(context),
    drain: async () => {
      await service.drain();
      return petals.drain();
    },
    resume: () => {
      petals.resume();
      service.resumeRuntime();
    },
  };
}
