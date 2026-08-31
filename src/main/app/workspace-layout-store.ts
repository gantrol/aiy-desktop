import { createHash } from 'node:crypto';
import path from 'node:path';
import { readBoundedJsonWithBackup, writeJsonAtomically } from '@/main/app/atomic-json-file';
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

  constructor(userDataRoot: string) {
    this.directory = path.join(userDataRoot, 'ui-state', 'workspaces');
  }

  load(spaceId: string): WorkspaceLayoutSnapshotDto | null {
    const parsed = workspaceLayoutSnapshotSchema.safeParse(
      readBoundedJsonWithBackup(this.filePath(spaceId), MAXIMUM_LAYOUT_BYTES),
    );
    if (!parsed.success || parsed.data.spaceId !== spaceId) return null;
    return parsed.data;
  }

  save(rawInput: WorkspaceLayoutSaveInput): WorkspaceLayoutSaveResult {
    const input = workspaceLayoutSaveInputSchema.parse(rawInput);
    const current = this.load(input.spaceId);
    if ((current?.revision ?? 0) !== input.expectedRevision) {
      return { status: 'conflict', snapshot: current };
    }
    const snapshot = workspaceLayoutSnapshotSchema.parse({
      schemaVersion: 1,
      spaceId: input.spaceId,
      revision: input.expectedRevision + 1,
      state: input.state,
    });
    writeJsonAtomically(this.filePath(input.spaceId), snapshot);
    return { status: 'saved', snapshot };
  }

  private filePath(spaceId: string) {
    const key = createHash('sha256').update(spaceId).digest('hex');
    return path.join(this.directory, `${key}.json`);
  }
}
