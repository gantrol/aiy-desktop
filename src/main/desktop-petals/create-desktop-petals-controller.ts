import { app, type BrowserWindow } from 'electron';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { DesktopPetalsController } from '@/main/desktop-petals/desktop-petals-controller';

export function createDesktopPetalsController(
  shell: { mainWindow: BrowserWindow | null; activeLibraryContext: ActiveLibraryContext | null; updateAppTray(): void },
  allowPresentation: boolean,
) {
  return new DesktopPetalsController({
    userDataRoot: app.getPath('userData'),
    getMainWindow: () => shell.mainWindow,
    getContext: () => shell.activeLibraryContext,
    allowPresentation,
    onTrayStateChanged: () => shell.updateAppTray(),
  });
}
