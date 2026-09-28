import { ipcRenderer } from 'electron';
import { z } from 'zod';
import {
  workScopeSchema,
  workMutationSchema,
  workHandoffInputSchema,
  workResultSchema,
  workSnapshotSchema,
  type WorkTrackingApi,
} from '@/shared/contracts/work-tracking';

export function createWorkTrackingApi(): WorkTrackingApi {
  const snapshot = workResultSchema(workSnapshotSchema);
  return {
    read: async (input) => snapshot.parse(await ipcRenderer.invoke('work-tracking:read', workScopeSchema.parse(input))),
    mutate: async (input) =>
      snapshot.parse(await ipcRenderer.invoke('work-tracking:mutate', workMutationSchema.parse(input))),
    handoff: async (input) =>
      workResultSchema(z.string().max(1_000_000)).parse(
        await ipcRenderer.invoke('work-tracking:handoff', workHandoffInputSchema.parse(input)),
      ),
  };
}
