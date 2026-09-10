import { ipcRenderer } from 'electron';
import { derivedVisualAdoptInputSchema } from '@/shared/contracts/derived-visual';
import {
  derivedVisualUndoInputSchema,
  derivedVisualOperationIdentitySchema,
  derivedVisualOperationsListInputSchema,
  derivedVisualOperationRequestSchema,
  derivedVisualOperationSchema,
  type DerivedVisualOperationsApi,
} from '@/shared/contracts/derived-visual-operations';

export const derivedVisualOperationsApi: DerivedVisualOperationsApi = {
  derivedVisualAdopt: async (input) =>
    derivedVisualOperationSchema.parse(
      await ipcRenderer.invoke('derived-visual:adopt', derivedVisualAdoptInputSchema.parse(input)),
    ),
  derivedVisualUndo: async (input) =>
    derivedVisualOperationSchema.parse(
      await ipcRenderer.invoke('derived-visual:undo', derivedVisualUndoInputSchema.parse(input)),
    ),
  derivedVisualOperationGet: (input) =>
    ipcRenderer.invoke('derived-visual:operation-get', derivedVisualOperationIdentitySchema.parse(input)),
  derivedVisualOperationsList: (input) =>
    ipcRenderer.invoke('derived-visual:operations-list', derivedVisualOperationsListInputSchema.parse(input)),
  derivedVisualOperationCancel: async (input) =>
    derivedVisualOperationSchema.parse(
      await ipcRenderer.invoke('derived-visual:operation-cancel', derivedVisualOperationRequestSchema.parse(input)),
    ),
};
