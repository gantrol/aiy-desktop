import { createHash } from 'node:crypto';
import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { readBoundedJsonWithBackupSourceAsync, writeJsonAtomicallyAsync } from '@/main/app/atomic-json-file';
import {
  workspaceLayoutSaveInputSchema,
  workspaceLayoutSnapshotSchema,
  type WorkspaceLayoutSaveInput,
  type WorkspaceLayoutSaveResult,
  type WorkspaceLayoutSnapshotDto,
} from '@/shared/contracts/workspace-layout';

const MAXIMUM_LAYOUT_BYTES = 512 * 1024;

export class WorkspaceLayoutStore {
  private readonly directory: string;
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(userDataRoot: string) {
    this.directory = path.join(userDataRoot, 'ui-state', 'workspaces');
  }

  private async read(spaceId: string) {
    const stored = await readBoundedJsonWithBackupSourceAsync(this.filePath(spaceId), MAXIMUM_LAYOUT_BYTES, (value) => {
      const parsed = workspaceLayoutSnapshotSchema.safeParse(value);
      return parsed.success && parsed.data.spaceId === spaceId;
    });
    return stored ? { snapshot: workspaceLayoutSnapshotSchema.parse(stored.value), source: stored.source } : null;
  }

  async load(spaceId: string): Promise<WorkspaceLayoutSnapshotDto | null> {
    await this.pending.get(spaceId)?.catch(() => undefined);
    return (await this.read(spaceId))?.snapshot ?? null;
  }

  async save(rawInput: WorkspaceLayoutSaveInput): Promise<WorkspaceLayoutSaveResult> {
    const input = workspaceLayoutSaveInputSchema.parse(rawInput);
    const operation = (this.pending.get(input.spaceId) ?? Promise.resolve())
      .catch(() => undefined)
      .then(async (): Promise<WorkspaceLayoutSaveResult> => {
        const stored = await this.read(input.spaceId);
        const current = stored?.snapshot ?? null;
        if ((current?.revision ?? 0) !== input.expectedRevision) {
          return { status: 'conflict', snapshot: current };
        }
        const snapshot = workspaceLayoutSnapshotSchema.parse({
          schemaVersion: 1,
          spaceId: input.spaceId,
          revision: input.expectedRevision + 1,
          state: input.state,
        });
        if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAXIMUM_LAYOUT_BYTES) {
          throw new Error('WORKSPACE_LAYOUT_TOO_LARGE');
        }
        if (stored?.source === 'backup') {
          try {
            await unlink(this.filePath(input.spaceId));
          } catch (reason) {
            if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason;
          }
        }
        await writeJsonAtomicallyAsync(this.filePath(input.spaceId), snapshot);
        return { status: 'saved', snapshot };
      });
    this.pending.set(input.spaceId, operation);
    try {
      return await operation;
    } finally {
      if (this.pending.get(input.spaceId) === operation) this.pending.delete(input.spaceId);
    }
  }

  private filePath(spaceId: string) {
    const key = createHash('sha256').update(spaceId).digest('hex');
    return path.join(this.directory, `${key}.json`);
  }
}
