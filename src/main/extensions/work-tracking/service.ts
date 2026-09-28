import path from 'node:path';
import { ZodError } from 'zod';
import type { LibraryDatabase } from '@/main/database';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import { WorkTrackingStore } from '@/main/extensions/work-tracking/store';
import { WorkTrackingSources } from '@/main/extensions/work-tracking/sources';
import { WorkTrackingError } from '@/main/extensions/work-tracking/errors';
import { WORK_TRACKING_EXTENSION_ID } from '@/shared/extension-ids';
import {
  workScopeSchema,
  workMutationSchema,
  workHandoffInputSchema,
  type WorkResult,
  type WorkTrackingApi,
} from '@/shared/contracts/work-tracking';
import { agentWorkListSchema, agentWorkListResultSchema } from '@/shared/contracts/agent-work';
import { listWorkAlbum } from '@/main/extensions/work-tracking/album-query';

/** One instance in the library's singleton worker serializes both UI and CLI writes. */
export class WorkTrackingService implements WorkTrackingApi {
  private readonly stores = new Map<string, WorkTrackingStore>();
  constructor(
    private readonly database: LibraryDatabase,
    private readonly extensions: ExtensionRegistry,
  ) {}

  private async invoke<T>(
    raw: unknown,
    operation: (store: WorkTrackingStore, sources: WorkTrackingSources, check: () => void) => Promise<T>,
    guard?: () => void,
  ): Promise<WorkResult<T>> {
    try {
      const { spaceId } = workScopeSchema.parse({ spaceId: (raw as { spaceId?: unknown } | null)?.spaceId });
      const sources = new WorkTrackingSources(this.database);
      const root = this.database.libraryRoot;
      const check = () => {
        guard?.();
        if (
          !this.extensions.get(WORK_TRACKING_EXTENSION_ID) ||
          !this.extensions.isActivated(WORK_TRACKING_EXTENSION_ID)
        )
          throw new WorkTrackingError('disabled');
        if (sources.spaceId() !== spaceId || this.database.libraryRoot !== root)
          throw new WorkTrackingError('spaceChanged');
      };
      check();
      const filePath = path.join(root, 'extension-data', WORK_TRACKING_EXTENSION_ID, 'state.json');
      let store = this.stores.get(filePath);
      if (!store) {
        store = new WorkTrackingStore(filePath, spaceId);
        this.stores.set(filePath, store);
      }
      const value = await operation(store, sources, check);
      check();
      return { ok: true, value };
    } catch (error) {
      if (guard && !(error instanceof WorkTrackingError) && !(error instanceof ZodError)) throw error;
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
  read(raw: Parameters<WorkTrackingApi['read']>[0], guard?: () => void) {
    return this.invoke(
      raw,
      (store) => {
        workScopeSchema.parse(raw);
        return store.read();
      },
      guard,
    );
  }
  mutate(raw: Parameters<WorkTrackingApi['mutate']>[0], guard?: () => void) {
    return this.invoke(
      raw,
      (store, sources, check) => store.mutate(workMutationSchema.parse(raw), sources, check, guard ? 'CLI' : 'USER'),
      guard,
    );
  }
  handoff(raw: Parameters<WorkTrackingApi['handoff']>[0]) {
    return this.invoke(raw, (store) => store.handoff(workHandoffInputSchema.parse(raw).taskId));
  }
  list(raw: unknown, guard: () => void) {
    const input = agentWorkListSchema.parse(raw);
    return this.invoke(
      input,
      async (store) => {
        const snapshot = await store.read();
        return agentWorkListResultSchema.parse(listWorkAlbum(this.database, input, snapshot));
      },
      guard,
    );
  }
}
