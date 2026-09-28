import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';

export type InitializePetalWindow = (window: BrowserWindow, navigating: boolean) => Promise<PetalWindow>;
export interface PetalWindowFactory {
  onRendererGone?: (windows: readonly BrowserWindow[]) => void;
  create(
    options: BrowserWindowConstructorOptions,
    url: URL,
    shared: boolean,
    initialize: InitializePetalWindow,
  ): Promise<PetalWindow>;
  dispose(): void;
}

/** Native editors and drawers keep their own renderer and lifetime. */
export const nativePetalWindows: PetalWindowFactory = {
  create: async (options, _url, _shared, initialize) => initialize(new BrowserWindow(options), false),
  dispose() {},
};
