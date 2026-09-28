import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { writeJsonAtomicallyAsync } from '@/main/app/atomic-json-file';
import {
  workStateSchema,
  type WorkMutation,
  type WorkSnapshot,
  type WorkState,
} from '@/shared/contracts/work-tracking';
import { WorkTrackingError } from '@/main/extensions/work-tracking/errors';
import { mutateWorkState } from '@/main/extensions/work-tracking/mutations';
import type { WorkTrackingSources } from '@/main/extensions/work-tracking/sources';

const maximumBytes = 16 * 1024 * 1024;

async function readState(filePath: string) {
  const handle = await open(filePath, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximumBytes) throw new WorkTrackingError('limit');
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > stat.size) throw new WorkTrackingError('storageUnavailable');
    return workStateSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))),
    );
  } finally {
    await handle.close();
  }
}

/** Small, bounded plugin store. No library schema changes or copies of editable source content. */
export class WorkTrackingStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly filePath: string,
    private readonly spaceId: string,
  ) {}

  private async load(): Promise<WorkState> {
    try {
      const state = await readState(this.filePath);
      if (state.spaceId !== this.spaceId) throw new WorkTrackingError('spaceChanged');
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          const backup = await readState(`${this.filePath}.bak`);
          if (backup.spaceId !== this.spaceId) throw new WorkTrackingError('spaceChanged');
          return backup;
        } catch (backupError) {
          if ((backupError as NodeJS.ErrnoException).code === 'ENOENT')
            return {
              version: 1,
              spaceId: this.spaceId,
              revision: 0,
              items: [],
              tasks: [],
              attempts: [],
              executions: [],
              history: [],
            };
        }
      }
      // Corrupt existing files never become an empty, writable store.
      throw new WorkTrackingError('storageUnavailable');
    }
  }

  private snapshot(state: WorkState): WorkSnapshot {
    return { ...state, tasks: state.tasks.map(({ packet: _packet, ...task }) => task) };
  }

  async read() {
    await this.pending;
    return this.snapshot(await this.load());
  }

  async handoff(taskId: string) {
    await this.pending;
    const task = (await this.load()).tasks.find((entry) => entry.id === taskId);
    if (!task) throw new WorkTrackingError('missingTask');
    return task.packet.brief;
  }

  mutate(input: WorkMutation, sources: WorkTrackingSources, checkActive: () => void, actor: 'USER' | 'CLI' = 'USER') {
    const operation = this.pending.then(async () => {
      checkActive();
      const state = await this.load();
      checkActive();
      const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      const previous = state.history.find((entry) => entry.requestId === input.requestId);
      if (previous) {
        if (previous.digest !== digest) throw new WorkTrackingError('conflict');
        return this.snapshot(state);
      }
      if (state.revision !== input.revision) throw new WorkTrackingError('conflict');
      const change = mutateWorkState(state, input, sources);
      state.revision++;
      state.history.push({
        ...change,
        requestId: input.requestId,
        digest,
        action: input.action,
        actor,
        note: input.note,
        occurredAt: new Date().toISOString(),
      });
      const parsed = workStateSchema.safeParse(state);
      if (!parsed.success || Buffer.byteLength(JSON.stringify(state), 'utf8') > maximumBytes)
        throw new WorkTrackingError('limit');
      checkActive();
      try {
        await writeJsonAtomicallyAsync(this.filePath, parsed.data);
      } catch {
        throw new WorkTrackingError('storageUnavailable');
      }
      return this.snapshot(parsed.data);
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
}
