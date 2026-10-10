import {
  embeddedWebClosedSchema,
  embeddedWebHideSchema,
  embeddedWebShowSchema,
  type EmbeddedWebApi,
} from '@/shared/contracts/embedded-web';
import { createHtmlFileApi } from '@/preload/html-file-api';
import type { HtmlFileApi } from '@/shared/contracts/html-file';
import { createReadingFileApi } from '@/preload/reading-file-api';
import type { CreationReadingApi } from '@/shared/contracts/creation-reading';

export function createEmbeddedWebApi(
  ipc: Pick<Electron.IpcRenderer, 'invoke' | 'on' | 'removeListener'>,
): EmbeddedWebApi & HtmlFileApi & CreationReadingApi {
  return {
    ...createHtmlFileApi(ipc),
    ...createReadingFileApi(ipc),
    embeddedWebShow: (input) => ipc.invoke('embedded-web:show', embeddedWebShowSchema.parse(input)),
    embeddedWebHide: (input) => ipc.invoke('embedded-web:hide', embeddedWebHideSchema.parse(input)),
    onEmbeddedWebClosed: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, raw: unknown) => {
        const result = embeddedWebClosedSchema.safeParse(raw);
        if (result.success) callback(result.data);
      };
      ipc.on('embedded-web:closed', listener);
      return () => ipc.removeListener('embedded-web:closed', listener);
    },
  };
}
