import { useEffect, useRef } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Options {
  settingsOpen: boolean;
  notify(message: string): void;
}

export function useAppUpdateNotification({ settingsOpen, notify }: Options) {
  const { messages } = useI18n();
  const availableMessage = messages.app.settings.updateAvailableNotification;
  const notifiedVersion = useRef<string | null>(null);

  useEffect(
    () =>
      window.desktopApi.onAppUpdateChanged((state) => {
        if (state.phase !== 'AVAILABLE' || !state.targetVersion || notifiedVersion.current === state.targetVersion) {
          return;
        }
        notifiedVersion.current = state.targetVersion;
        if (!settingsOpen) notify(availableMessage(state.targetVersion));
      }),
    [availableMessage, notify, settingsOpen],
  );
}
