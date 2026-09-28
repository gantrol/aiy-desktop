import { Notification } from 'electron';
import type { PetalLanguage } from '@/shared/contracts/petal-language';

export function showPetalTimerNotification(
  language: PetalLanguage,
  phase: 'focus' | 'break',
  reveal: () => Promise<void>,
) {
  if (!Notification.isSupported()) return;
  const notification = new Notification({
    title: language.messages.timer[phase],
    body: language.messages.timer.done,
  });
  notification.on('click', () => {
    void reveal().catch((error) => console.error('[desktop-petals] timer reveal failed', error));
  });
  notification.show();
}
