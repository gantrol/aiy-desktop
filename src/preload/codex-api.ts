import type { IpcRenderer } from 'electron';
import type { DesktopApi } from '@/shared/contracts';
import { codexThreadIdSchema } from '@/shared/contracts/codex-thread';

type CodexPreloadApi = Pick<DesktopApi, 'codexHealth' | 'codexOpenThread'>;

export function createCodexPreloadApi(ipcRenderer: IpcRenderer): CodexPreloadApi {
  return {
    codexHealth: () => ipcRenderer.invoke('codex:health'),
    codexOpenThread: (threadId) => ipcRenderer.invoke('codex:open-thread', codexThreadIdSchema.parse(threadId)),
  };
}
