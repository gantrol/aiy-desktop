import { ipcRenderer } from 'electron';
import type { DesktopApi } from '@/shared/contracts';
import { creationOutlineCommandSchema, creationOutlineResultSchema } from '@/shared/contracts/creation-outline';
import { creationItemMoveInputSchema, creationItemMoveResultSchema } from '@/shared/contracts/creation-library';
import {
  creationOrganizationCommandSchema,
  creationOrganizationResultSchema,
} from '@/shared/contracts/creation-organization';

export const creationOutlineApi: Pick<
  DesktopApi,
  'creationOutlineCommand' | 'creationItemMove' | 'creationOrganizationCommand'
> = {
  creationOrganizationCommand: async (input) =>
    creationOrganizationResultSchema.parse(
      await ipcRenderer.invoke('creation-organization:command', creationOrganizationCommandSchema.parse(input)),
    ),
  creationOutlineCommand: async (input) =>
    creationOutlineResultSchema.parse(
      await ipcRenderer.invoke('creation-outline:command', creationOutlineCommandSchema.parse(input)),
    ),
  creationItemMove: async (input) =>
    creationItemMoveResultSchema.parse(
      await ipcRenderer.invoke('creation-item:move', creationItemMoveInputSchema.parse(input)),
    ),
};
