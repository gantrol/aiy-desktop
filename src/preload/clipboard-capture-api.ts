import { ipcRenderer } from 'electron';
import {
  clipboardCommandSchema,
  clipboardResultSchema,
  type ClipboardCaptureApi,
} from '@/shared/contracts/clipboard-capture';

export function createClipboardCaptureApi(): ClipboardCaptureApi {
  return {
    onOpenHistory: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('clipboard-capture:open-history', listener);
      return () => ipcRenderer.removeListener('clipboard-capture:open-history', listener);
    },
    execute: async (command) =>
      clipboardResultSchema.parse(
        await ipcRenderer.invoke('clipboard-capture:execute', clipboardCommandSchema.parse(command)),
      ),
    onChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on('clipboard-capture:changed', listener);
      return () => ipcRenderer.removeListener('clipboard-capture:changed', listener);
    },
  };
}
