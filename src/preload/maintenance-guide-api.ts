import { ipcRenderer } from 'electron';
import { z } from 'zod';
import {
  maintenanceDocumentSchema,
  maintenanceMutationSchema,
  maintenanceOpenInputSchema,
  maintenanceProjectInputSchema,
  maintenanceReadInputSchema,
  maintenanceResultSchema,
  maintenanceRevisionInputSchema,
  maintenanceStateSchema,
  type MaintenanceGuideApi,
} from '@/shared/contracts/maintenance-guide';

export function createMaintenanceGuideApi(): MaintenanceGuideApi {
  const stateResult = maintenanceResultSchema(maintenanceStateSchema);
  return {
    list: async () => stateResult.parse(await ipcRenderer.invoke('maintenance-guide:list')),
    mutate: async (input) =>
      stateResult.parse(await ipcRenderer.invoke('maintenance-guide:mutate', maintenanceMutationSchema.parse(input))),
    attachGuide: async (input) =>
      stateResult.parse(
        await ipcRenderer.invoke('maintenance-guide:attach', maintenanceProjectInputSchema.parse(input)),
      ),
    readGuide: async (input) =>
      maintenanceResultSchema(maintenanceDocumentSchema).parse(
        await ipcRenderer.invoke('maintenance-guide:read', maintenanceReadInputSchema.parse(input)),
      ),
    openTool: async (input) =>
      maintenanceResultSchema(z.null()).parse(
        await ipcRenderer.invoke('maintenance-guide:open', maintenanceOpenInputSchema.parse(input)),
      ),
    importProjects: async (input) =>
      stateResult.parse(
        await ipcRenderer.invoke('maintenance-guide:import', maintenanceRevisionInputSchema.parse(input)),
      ),
    exportProjects: async () =>
      maintenanceResultSchema(z.boolean()).parse(await ipcRenderer.invoke('maintenance-guide:export')),
  };
}
