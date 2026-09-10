import { ipcRenderer } from 'electron';
import {
  creatorInputRecoveryRecordSchema,
  creatorInputRecoverySaveResultSchema,
  creatorInputRecoverySaveSchema,
  creatorInputRecoveryScopeSchema,
  type CreatorInputRecoveryApi,
} from '@/shared/contracts/creator-input-recovery';

export const creatorInputRecoveryApi: CreatorInputRecoveryApi = {
  async creatorInputRecoveryLoad(scope) {
    return creatorInputRecoveryRecordSchema
      .nullable()
      .parse(await ipcRenderer.invoke('creator-input-recovery:load', creatorInputRecoveryScopeSchema.parse(scope)));
  },
  async creatorInputRecoverySave(input) {
    return creatorInputRecoverySaveResultSchema.parse(
      await ipcRenderer.invoke('creator-input-recovery:save', creatorInputRecoverySaveSchema.parse(input)),
    );
  },
};
