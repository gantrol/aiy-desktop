import { useEffect, useRef } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Options {
  settingsOpen: boolean;
  notify(message: string): void;
}

export function useAppUpdateNotification({ settingsOpen, notify }: Options) {
  const { messages } = useI18n();
  const availableMessage = messages.app.settings.microsoftStoreUpdateAvailableNotification;
  const notified = useRef(false);

  useEffect(
    () =>
      window.desktopApi.onAppUpdateChanged((state) => {
        if (state.phase !== 'AVAILABLE' || notified.current) return;
        notified.current = true;
        if (!settingsOpen) notify(availableMessage);
      }),
    [availableMessage, notify, settingsOpen],
  );
}
