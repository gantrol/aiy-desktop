import { Notification } from 'electron';

/** Keeps a single completion notification alive until it is dismissed or consumed. */
export class BackgroundTaskNotification {
  private notification: Notification | null = null;
  private disposed = false;

  constructor(private readonly onClick: () => void) {}

  show(title: string, body: string) {
    if (this.disposed) return;
    this.clear();
    try {
      if (!Notification.isSupported()) return;
      const notification = new Notification({ id: 'aiy-background-tasks-complete', title, body });
      this.notification = notification;
      const release = () => {
        if (this.notification === notification) this.notification = null;
        notification.removeAllListeners();
      };
      notification.once('close', release);
      notification.once('failed', (_event, error) => {
        release();
        console.warn('[background-tasks] Completion notification failed', error);
      });
      notification.once('click', () => {
        if (this.notification !== notification || this.disposed) return;
        this.clear();
        try {
          this.onClick();
        } catch (error) {
          console.error('[background-tasks] Failed to restore the main window', error);
        }
      });
      notification.show();
    } catch (error) {
      this.clear();
      console.warn('[background-tasks] Completion notification unavailable', error);
    }
  }

  clear() {
    const notification = this.notification;
    this.notification = null;
    if (!notification) return;
    notification.removeAllListeners();
    try {
      notification.close();
    } catch (error) {
      console.warn('[background-tasks] Failed to close completion notification', error);
    }
  }

  dispose() {
    this.disposed = true;
    this.clear();
  }
}
