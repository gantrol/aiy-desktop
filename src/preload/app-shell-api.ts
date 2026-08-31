import { ipcRenderer } from 'electron';
import type { DesktopApi } from '@/shared/contracts';
import {
  APP_DEEP_LINK_AVAILABLE_CHANNEL,
  APP_DEEP_LINKS_TAKE_CHANNEL,
  appDeepLinkCommandListSchema,
} from '@/shared/contracts/app-deep-link';
import {
  transitionPreviewListSchema,
  transitionPreviewRefreshEventSchema,
  type TransitionPreviewDto,
} from '@/shared/contracts/local-space';

type AppShellPreloadApi = Pick<
  DesktopApi,
  'appLoadingPreviews' | 'onAppLoadingPreviewsRefreshed' | 'appDeepLinksTake' | 'onAppDeepLinksAvailable'
>;

let loadingPreviewsInFlight: Promise<TransitionPreviewDto[]> | null = null;

function appLoadingPreviews() {
  if (loadingPreviewsInFlight) return loadingPreviewsInFlight;
  const request = ipcRenderer.invoke('app:loading-previews').then((value) => transitionPreviewListSchema.parse(value));
  loadingPreviewsInFlight = request;
  const clearInFlight = () => {
    if (loadingPreviewsInFlight === request) loadingPreviewsInFlight = null;
  };
  void request.then(clearInFlight, clearInFlight);
  return request;
}

export function createAppShellPreloadApi(): AppShellPreloadApi {
  return {
    appLoadingPreviews,
    onAppLoadingPreviewsRefreshed: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) =>
        callback(transitionPreviewRefreshEventSchema.parse(value));
      ipcRenderer.on('app:loading-previews-refreshed', listener);
      return () => ipcRenderer.removeListener('app:loading-previews-refreshed', listener);
    },
    appDeepLinksTake: async () =>
      appDeepLinkCommandListSchema.parse(await ipcRenderer.invoke(APP_DEEP_LINKS_TAKE_CHANNEL)),
    onAppDeepLinksAvailable: (callback) => {
      const listener = () => callback();
      ipcRenderer.on(APP_DEEP_LINK_AVAILABLE_CHANNEL, listener);
      return () => ipcRenderer.removeListener(APP_DEEP_LINK_AVAILABLE_CHANNEL, listener);
    },
  };
}
