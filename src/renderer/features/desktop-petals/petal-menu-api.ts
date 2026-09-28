import { createContext, useContext } from 'react';
import type { DesktopPetalsApi } from '@/shared/contracts/desktop-petals';

/** The commands a context menu can invoke, all retaining the originating window's sender. */
export function petalMenuApi(api: DesktopPetalsApi) {
  const {
    openMain,
    setAlwaysOnTop,
    boardCommand,
    hide,
    remove,
    cleanup,
    undoCollection,
    hubView,
    timerAction,
    showAll,
    hidePetals,
    drawer,
  } = api;
  return {
    openMain,
    setAlwaysOnTop,
    boardCommand,
    hide,
    remove,
    cleanup,
    undoCollection,
    hubView,
    timerAction,
    showAll,
    hidePetals,
    drawer,
  };
}
export type PetalMenuApi = ReturnType<typeof petalMenuApi>;
export const PetalMenuApiContext = createContext<PetalMenuApi | null>(null);
export function usePetalMenuApi(): PetalMenuApi {
  return useContext(PetalMenuApiContext) ?? window.desktopPetals;
}

export interface PetalMenuExecutionOptions {
  dismiss?: boolean;
  prepare?: boolean;
}

/** The source document owns the whole command, including work after the menu closes. */
export type PetalMenuExecutor = <Args extends unknown[]>(
  action: (...args: Args) => Promise<unknown>,
  args: Args,
  options?: PetalMenuExecutionOptions,
) => Promise<void>;
export const PetalMenuExecutionContext = createContext<PetalMenuExecutor | null>(null);
export const usePetalMenuExecutor = () => useContext(PetalMenuExecutionContext);

export interface PetalMenuControl {
  anchor: { x: number; y: number };
  close(): Promise<void>;
  dismiss(): void;
  select<Args extends unknown[]>(action: (...args: Args) => Promise<unknown>, ...args: Args): void;
  restoreFocus(): void;
}
