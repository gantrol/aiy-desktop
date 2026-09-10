import { ipcRenderer } from 'electron';
import { gifPlanRequestSchema } from '@/shared/contracts/gif-motion-plan';
import type { GifMakingApi, GifProgress } from '@/shared/contracts/gif-making';
import {
  gifSaveSchema,
  gifExportSchema,
  gifWorkspaceStateSchema,
  gifWorkspaceCreateSchema,
} from '@/shared/contracts/gif-making';
import {
  gifGenerationStartSchema,
  gifGenerationAdoptSchema,
  type GifGenerationProgress,
} from '@/shared/contracts/gif-generation';

export const gifMakingApi: GifMakingApi = {
  gifWorkspaceOpen: (documentId) => ipcRenderer.invoke('gif:workspace-open', documentId),
  gifWorkspaceCreate: (input) => ipcRenderer.invoke('gif:workspace-create', gifWorkspaceCreateSchema.parse(input)),
  gifFramesAsGroup: (documentId, candidateId) => ipcRenderer.invoke('gif:frames-as-group', documentId, candidateId),
  gifWorkspaceSave: (id, state) => ipcRenderer.invoke('gif:workspace-save', id, gifWorkspaceStateSchema.parse(state)),
  gifGenerationRoutes: () => ipcRenderer.invoke('gif:generation-routes'),
  gifGenerate: (input) => ipcRenderer.invoke('gif:generate', gifGenerationStartSchema.parse(input)),
  gifPlan: (input) => ipcRenderer.invoke('gif:plan', gifPlanRequestSchema.parse(input)),
  gifGenerationLatest: (id) => ipcRenderer.invoke('gif:generation-latest', id),
  gifGenerationHistory: (id) => ipcRenderer.invoke('gif:generation-history', id),
  gifGenerationCancel: (id) => ipcRenderer.invoke('gif:generation-cancel', id),
  gifGenerationAdopt: (input) => ipcRenderer.invoke('gif:generation-adopt', gifGenerationAdoptSchema.parse(input)),
  onGifGenerationProgress(listener) {
    const receive = (_event: Electron.IpcRendererEvent, progress: GifGenerationProgress) => listener(progress);
    ipcRenderer.on('gif:generation-progress', receive);
    return () => ipcRenderer.removeListener('gif:generation-progress', receive);
  },
  gifList: (id, purpose) => ipcRenderer.invoke('gif:list', id, purpose),
  gifLoad: (id) => ipcRenderer.invoke('gif:load', id),
  gifFindForAsset: (id, purpose, seriesId) => ipcRenderer.invoke('gif:find-for-asset', id, purpose, seriesId),
  gifSave: (input) => ipcRenderer.invoke('gif:save', gifSaveSchema.parse(input)),
  gifImport: (input) => ipcRenderer.invoke('gif:import', input),
  gifExport: (input) => ipcRenderer.invoke('gif:export', gifExportSchema.parse(input)),
  gifCancel: (id) => ipcRenderer.invoke('gif:cancel', id),
  onGifProgress(listener) {
    const receive = (_event: Electron.IpcRendererEvent, progress: GifProgress) => listener(progress);
    ipcRenderer.on('gif:progress', receive);
    return () => ipcRenderer.removeListener('gif:progress', receive);
  },
};
