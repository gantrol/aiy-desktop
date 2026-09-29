import { useEffect, useRef } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Options {
  updateSurfaceVisible: boolean;
  notify(message: string): void;
}

export function useAppUpdateNotification({ updateSurfaceVisible, notify }: Options) {
  const { messages } = useI18n();
  const availableMessage = messages.app.settings.microsoftStoreUpdateAvailableNotification;
  const notified = useRef(false);

  useEffect(
    () =>
      window.desktopApi.onAppUpdateChanged((state) => {
        if (state.phase !== 'AVAILABLE' || notified.current) return;
        notified.current = true;
        if (!updateSurfaceVisible) notify(availableMessage);
      }),
    [availableMessage, notify, updateSurfaceVisible],
  );
}
