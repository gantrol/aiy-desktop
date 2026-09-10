import { CreatorInputRecoveryStore } from '@/main/app/creator-input-recovery-store';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';

export function registerCreatorInputRecoveryIpc(ipcMain: IpcHandlerRegistrar, userDataRoot: string) {
  const store = new CreatorInputRecoveryStore(userDataRoot);
  ipcMain.handle('creator-input-recovery:load', (_event, input) => store.load(input));
  ipcMain.handle('creator-input-recovery:save', (_event, input) => store.save(input));
}
