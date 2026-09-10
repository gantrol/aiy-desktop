import { ipcRenderer } from 'electron';
import {
  socialPostRecoveryRecordSchema,
  socialPostRecoverySaveResultSchema,
  socialPostRecoverySaveSchema,
  socialPostRecoveryScopeSchema,
  type SocialPostRecoveryApi,
} from '@/shared/contracts/social-post-recovery';

export const socialPostRecoveryApi: SocialPostRecoveryApi = {
  async socialPostRecoveryLoad(scope) {
    return socialPostRecoveryRecordSchema
      .nullable()
      .parse(await ipcRenderer.invoke('social-post-recovery:load', socialPostRecoveryScopeSchema.parse(scope)));
  },
  async socialPostRecoverySave(input) {
    return socialPostRecoverySaveResultSchema.parse(
      await ipcRenderer.invoke('social-post-recovery:save', socialPostRecoverySaveSchema.parse(input)),
    );
  },
};
