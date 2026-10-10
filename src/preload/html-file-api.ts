import {
  htmlFileAttributesSchema,
  htmlFileImportSchema,
  htmlFilePreviewAccessSchema,
  htmlFilePreviewSchema,
  type HtmlFileApi,
} from '@/shared/contracts/html-file';
import { embeddedWebHideSchema } from '@/shared/contracts/embedded-web';

export function createHtmlFileApi(ipc: Pick<Electron.IpcRenderer, 'invoke'>): HtmlFileApi {
  return {
    htmlFileRead: async (input) => {
      const value: unknown = await ipc.invoke('html-file:read', htmlFilePreviewSchema.parse(input));
      if (typeof value !== 'string' || value.length > 4 * 1024 * 1024) throw new Error('HTML_FILE_UNAVAILABLE');
      return value;
    },
    htmlFileImport: async (input) =>
      htmlFileAttributesSchema.parse(await ipc.invoke('html-file:import', htmlFileImportSchema.parse(input))),
    htmlFilePreview: async (input) =>
      htmlFilePreviewAccessSchema.parse(await ipc.invoke('html-file:preview', htmlFilePreviewSchema.parse(input))),
    htmlFileRelease: (input) => ipc.invoke('html-file:release', embeddedWebHideSchema.parse(input)),
  };
}
