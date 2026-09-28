import { ZodError } from 'zod';
import type { LibraryDatabase } from '@/main/database';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import type { GenerationService } from '@/main/generation/service';
import { WorkTrackingSources } from '@/main/extensions/work-tracking/sources';
import { WorkTrackingError } from '@/main/extensions/work-tracking/errors';
import { WORK_TRACKING_EXTENSION_ID } from '@/shared/extension-ids';
import {
  workScopeSchema,
  workMutationSchema,
  workHandoffInputSchema,
  type WorkResult,
} from '@/shared/contracts/work-tracking';

export function registerWorkTrackingIpc(
  ipc: IpcHandlerRegistrar,
  database: LibraryDatabase,
  extensions: ExtensionRegistry,
  generation: GenerationService,
) {
  async function invoke<T>(raw: unknown, operation: () => Promise<WorkResult<T>> | undefined): Promise<WorkResult<T>> {
    try {
      const { spaceId } = workScopeSchema.parse({ spaceId: (raw as { spaceId?: unknown } | null)?.spaceId });
      const sources = new WorkTrackingSources(database);
      const root = database.libraryRoot;
      const check = () => {
        if (!extensions.get(WORK_TRACKING_EXTENSION_ID) || !extensions.isActivated(WORK_TRACKING_EXTENSION_ID))
          throw new WorkTrackingError('disabled');
        if (sources.spaceId() !== spaceId || database.libraryRoot !== root) throw new WorkTrackingError('spaceChanged');
      };
      check();
      const value = await operation();
      check();
      return value ?? { ok: false, code: 'storageUnavailable' };
    } catch (error) {
      return {
        ok: false,
        code:
          error instanceof WorkTrackingError
            ? error.code
            : error instanceof ZodError
              ? 'invalidInput'
              : 'storageUnavailable',
      };
    }
  }
  ipc.handle('work-tracking:read', (_event, raw) =>
    invoke(raw, () => generation.workTracking?.read(workScopeSchema.parse(raw))),
  );
  ipc.handle('work-tracking:mutate', (_event, raw) =>
    invoke(raw, () => generation.workTracking?.mutate(workMutationSchema.parse(raw))),
  );
  ipc.handle('work-tracking:handoff', (_event, raw) =>
    invoke(raw, () => generation.workTracking?.handoff(workHandoffInputSchema.parse(raw))),
  );
}
