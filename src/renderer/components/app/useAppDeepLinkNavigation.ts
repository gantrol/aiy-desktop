import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { AppLocation } from '@/renderer/components/app/app-navigation';

type NavigateApp = (destination: AppLocation | ((current: AppLocation) => AppLocation)) => void;

interface AppDeepLinkNavigationOptions {
  navigate: NavigateApp;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  setComparisonFullWindow: Dispatch<SetStateAction<boolean>>;
  setCreationPromptFullWindow: Dispatch<SetStateAction<boolean>>;
}

export function useAppDeepLinkNavigation(
  navigate: AppDeepLinkNavigationOptions['navigate'],
  setSettingsOpen: AppDeepLinkNavigationOptions['setSettingsOpen'],
  setComparisonFullWindow: AppDeepLinkNavigationOptions['setComparisonFullWindow'],
  setCreationPromptFullWindow: AppDeepLinkNavigationOptions['setCreationPromptFullWindow'],
) {
  useEffect(() => {
    let disposed = false;
    let drainQueue = Promise.resolve();

    const drain = () => {
      drainQueue = drainQueue
        .then(() => window.desktopApi.appDeepLinksTake())
        .then((commands) => {
          if (disposed || commands.length === 0) return;
          setSettingsOpen(false);
          setComparisonFullWindow(false);
          setCreationPromptFullWindow(false);
          for (const command of commands) {
            if (command.action !== 'open' || command.target !== 'gallery') continue;
            navigate((current) => ({
              ...current,
              view: 'gallery',
              gallery: {
                collection: { kind: 'all' },
                selectedMaterialKey: null,
                requestedMaterialId: null,
              },
              materialsReturnContext: null,
            }));
          }
        })
        .catch((error: unknown) => {
          console.error('[deep-link] Failed to consume pending navigation', error);
        });
    };

    const unsubscribe = window.desktopApi.onAppDeepLinksAvailable(drain);
    drain();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [navigate, setComparisonFullWindow, setCreationPromptFullWindow, setSettingsOpen]);
}
