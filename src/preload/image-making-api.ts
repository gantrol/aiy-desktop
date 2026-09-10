import { ipcRenderer } from 'electron';
import type { DesktopApi } from '@/shared/contracts';
import type { GifMakingApi } from '@/shared/contracts/gif-making';
import { gifMakingApi } from '@/preload/gif-making-api';

export const imageMakingApi: GifMakingApi &
  Pick<
    DesktopApi,
    'imageEditStart' | 'imageEditStartBatch' | 'imageCrop' | 'imageReframeStart' | 'codexImageRefinementStart'
  > = {
  ...gifMakingApi,
  imageEditStart: (input) => ipcRenderer.invoke('image-edit:start', input),
  imageEditStartBatch: (input) => ipcRenderer.invoke('image-edit:start-batch', input),
  imageCrop: (input) => ipcRenderer.invoke('image-transform:crop', input),
  imageReframeStart: (input) => ipcRenderer.invoke('image-transform:reframe-start', input),
  codexImageRefinementStart: (input) => ipcRenderer.invoke('codex:image-refinement-start', input),
};
