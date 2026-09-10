import { SocialPostRecoveryStore } from '@/main/app/social-post-recovery-store';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';

export function registerSocialPostRecoveryIpc(ipcMain: IpcHandlerRegistrar, userDataRoot: string) {
  const store = new SocialPostRecoveryStore(userDataRoot);
  ipcMain.handle('social-post-recovery:load', (_event, input) => store.load(input));
  ipcMain.handle('social-post-recovery:save', (_event, input) => store.save(input));
}
