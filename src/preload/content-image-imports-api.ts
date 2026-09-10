import type { DesktopApi } from '@/shared/contracts';
import type { ContentImageImportsApi } from '@/shared/contracts/content-image-import';
import { ipcRenderer } from 'electron';
export const contentImageImportsApi: ContentImageImportsApi &
  Pick<DesktopApi, 'creatorClipboardReferenceImport' | 'creatorReferencesImport'> = {
  creatorClipboardReferenceImport: (input) => ipcRenderer.invoke('creator:clipboard-reference-import', input),
  creatorReferencesImport: (input) => ipcRenderer.invoke('creator:references-import', input),
  contentImageAccepted: (id) => ipcRenderer.invoke('content-image:accepted', id),
  contentImageStage: (input) => ipcRenderer.invoke('content-image:stage', input),
  contentImageResolve: (id) => ipcRenderer.invoke('content-image:resolve', id),
};
