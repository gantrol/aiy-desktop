import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExtensionDto } from '@/shared/contracts';
import { TRANSITION_SHOWCASE_EXTENSION_ID } from '@/shared/extension-ids';
import type { AppLocation } from '@/renderer/components/app/app-navigation';

type ReplaceLocation = (destination: AppLocation | ((current: AppLocation) => AppLocation)) => void;

const NAVIGATION_ENABLED_STORAGE_KEY = 'aiy.transition-showcase-navigation-enabled.v1';

export interface TransitionShowcaseNavigationState {
  visible: boolean;
  enabled: boolean;
  setEnabled(enabled: boolean): void;
}

function isTransitionShowcaseAvailable(extensions: readonly ExtensionDto[] | undefined) {
  return Boolean(
    extensions?.some(
      (extension) =>
        extension.manifest.id === TRANSITION_SHOWCASE_EXTENSION_ID &&
        extension.enabled &&
        extension.compatible &&
        extension.permissions.every((permission) => !permission.required || permission.granted),
    ),
  );
}

export function useTransitionShowcaseNavigation(
  extensions: readonly ExtensionDto[] | undefined,
  view: AppLocation['view'],
  replaceLocation: ReplaceLocation,
): TransitionShowcaseNavigationState {
  const [enabled, setEnabledState] = useState(() => localStorage.getItem(NAVIGATION_ENABLED_STORAGE_KEY) === 'true');
  const visible = enabled && isTransitionShowcaseAvailable(extensions);
  const setEnabled = useCallback((nextEnabled: boolean) => {
    setEnabledState(nextEnabled);
    if (nextEnabled) localStorage.setItem(NAVIGATION_ENABLED_STORAGE_KEY, 'true');
    else localStorage.removeItem(NAVIGATION_ENABLED_STORAGE_KEY);
  }, []);

  useEffect(() => {
    if (!extensions || visible || view !== 'transitionShowcase') return;
    replaceLocation((current) => ({ ...current, view: 'creator', materialsReturnContext: null }));
  }, [extensions, replaceLocation, view, visible]);

  return useMemo(() => ({ visible, enabled, setEnabled }), [enabled, setEnabled, visible]);
}
