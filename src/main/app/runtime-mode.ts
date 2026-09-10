import type { App } from 'electron';

export function isPackagedApplication(app: Pick<App, 'isPackaged'>): boolean {
  // Electron infers isPackaged from the executable name. Our branded development
  // executable still loads the app through the default launcher (electron .).
  return app.isPackaged && process.defaultApp !== true;
}
