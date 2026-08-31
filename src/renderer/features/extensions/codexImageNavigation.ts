import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ExtensionDto } from '@/shared/contracts';
import {
  CODEX_HISTORY_SEARCH_EXTENSION_ID,
  CODEX_IMAGE_DISCOVERY_EXTENSION_ID,
  CODEX_USAGE_INVESTIGATOR_EXTENSION_ID,
  CODEX_VISUALIZATION_DISCOVERY_EXTENSION_ID,
} from '@/shared/extension-ids';
import type { AppLocation } from '@/renderer/components/app/app-navigation';

type ReplaceLocation = (destination: AppLocation | ((current: AppLocation) => AppLocation)) => void;
const NAVIGATION_HIDDEN_STORAGE_KEY = 'aiy.codex-images-navigation-hidden.v1';

export interface CodexImagesNavigationState {
  visible: boolean;
  enabled: boolean;
  setEnabled(enabled: boolean): void;
}

function isCodexImagesVisible(extensions: readonly ExtensionDto[] | undefined) {
  return Boolean(
    extensions?.some(
      (extension) =>
        (extension.manifest.id === CODEX_HISTORY_SEARCH_EXTENSION_ID ||
          extension.manifest.id === CODEX_IMAGE_DISCOVERY_EXTENSION_ID ||
          extension.manifest.id === CODEX_USAGE_INVESTIGATOR_EXTENSION_ID ||
          extension.manifest.id === CODEX_VISUALIZATION_DISCOVERY_EXTENSION_ID) &&
        extension.enabled &&
        extension.compatible &&
        extension.permissions.every((permission) => !permission.required || permission.granted),
    ),
  );
}

export function useCodexImagesNavigation(
  extensions: readonly ExtensionDto[] | undefined,
  view: AppLocation['view'],
  replaceLocation: ReplaceLocation,
): CodexImagesNavigationState {
  const [enabled, setEnabledState] = useState(() => localStorage.getItem(NAVIGATION_HIDDEN_STORAGE_KEY) !== 'true');
  const visible = enabled && isCodexImagesVisible(extensions);
  const setEnabled = useCallback((nextEnabled: boolean) => {
    setEnabledState(nextEnabled);
    if (nextEnabled) localStorage.removeItem(NAVIGATION_HIDDEN_STORAGE_KEY);
    else localStorage.setItem(NAVIGATION_HIDDEN_STORAGE_KEY, 'true');
  }, []);
  useEffect(() => {
    if (!extensions || visible || view !== 'codexImages') return;
    replaceLocation((current) => ({ ...current, view: 'creator', materialsReturnContext: null }));
  }, [extensions, replaceLocation, view, visible]);
  return useMemo(() => ({ visible, enabled, setEnabled }), [enabled, setEnabled, visible]);
}
