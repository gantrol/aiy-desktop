import {
  readingFileImportSchema,
  readingFileReadSchema,
  readingFileBytesSchema,
  type CreationReadingApi,
} from '@/shared/contracts/creation-reading';
import { noteFileSchema } from '@/shared/contracts/note-files';

export function createReadingFileApi(ipc: Pick<Electron.IpcRenderer, 'invoke'>): CreationReadingApi {
  return {
    readingFileImport: async (input) =>
      noteFileSchema.parse(await ipc.invoke('reading-file:import', readingFileImportSchema.parse(input))),
    readingFileRead: async (input) =>
      readingFileBytesSchema.parse(await ipc.invoke('reading-file:read', readingFileReadSchema.parse(input))),
  };
}
