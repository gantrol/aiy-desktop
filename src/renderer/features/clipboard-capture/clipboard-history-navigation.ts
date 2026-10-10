import { useEffect, useSyncExternalStore } from 'react';
import { initialAppLocation, type AppLocation } from '@/renderer/components/app/app-navigation';
import { CLIPBOARD_HISTORY_ID } from '@/shared/contracts/clipboard-capture';

let request = 0;
const listeners = new Set<() => void>();
const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};
export function useClipboardHistoryRequest() {
  return useSyncExternalStore(subscribe, () => request);
}
export function useClipboardHistoryNavigation(open: (location: AppLocation) => unknown) {
  useEffect(
    () =>
      window.desktopApi.clipboardCapture?.onOpenHistory?.(() => {
        request++;
        listeners.forEach((listener) => listener());
        open({
          ...initialAppLocation,
          view: 'packs',
          extensions: { tab: 'plugins', pluginId: CLIPBOARD_HISTORY_ID, packId: null },
        });
      }),
    [open],
  );
}
