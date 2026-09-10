import { randomUUID } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomicallyAsync } from '@/main/app/atomic-json-file';
import {
  maintenanceStateSchema,
  type MaintenanceErrorCode,
  type MaintenanceMutation,
  type MaintenanceProject,
  type MaintenanceState,
} from '@/shared/contracts/maintenance-guide';

const maximumStateBytes = 4 * 1024 * 1024;
const maximumGuideBytes = 256 * 1024;

export class MaintenanceGuideError extends Error {
  constructor(readonly code: MaintenanceErrorCode) {
    super(code);
  }
}

function approvedLocalPath(filePath: string) {
  if (
    !path.isAbsolute(filePath) ||
    /trash/i.test(filePath) ||
    filePath.startsWith('\\\\') ||
    filePath.startsWith('//')
  ) {
    throw new MaintenanceGuideError('invalidInput');
  }
}

export async function readMaintenanceFile(filePath: string, maximumBytes: number) {
  approvedLocalPath(filePath);
  const resolved = await realpath(filePath);
  approvedLocalPath(resolved);
  const handle = await open(resolved, 'r');
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) throw new MaintenanceGuideError('fileUnavailable');
    if (stats.size > maximumBytes) throw new MaintenanceGuideError('fileTooLarge');
    const buffer = Buffer.alloc(maximumBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maximumBytes) throw new MaintenanceGuideError('fileTooLarge');
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)),
      modifiedAt: stats.mtime.toISOString(),
      path: resolved,
    };
  } finally {
    await handle.close();
  }
}

export async function readMaintenanceGuide(filePath: string) {
  if (!['.md', '.markdown', '.txt'].includes(path.extname(filePath).toLowerCase()))
    throw new MaintenanceGuideError('invalidInput');
  return readMaintenanceFile(filePath, maximumGuideBytes);
}

export class MaintenanceGuideStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly filePath: string) {}

  async list(): Promise<MaintenanceState> {
    await this.pending;
    return this.load();
  }

  // Read on demand, including before mutations, so a stale renderer cannot overwrite another save.
  private async load(): Promise<MaintenanceState> {
    try {
      return maintenanceStateSchema.parse(
        JSON.parse((await readMaintenanceFile(this.filePath, maximumStateBytes)).text),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // The atomic writer may leave only the backup after an interrupted rename.
        try {
          return maintenanceStateSchema.parse(
            JSON.parse((await readMaintenanceFile(`${this.filePath}.bak`, maximumStateBytes)).text),
          );
        } catch (backupError) {
          if ((backupError as NodeJS.ErrnoException).code === 'ENOENT')
            return { version: 1, revision: 0, projects: [] };
        }
      }
      throw new MaintenanceGuideError('storageUnavailable');
    }
  }

  project(state: MaintenanceState, projectId: string): MaintenanceProject {
    const project = state.projects.find((item) => item.id === projectId);
    if (!project) throw new MaintenanceGuideError('missingProject');
    return project;
  }

  change(revision: number, checkActive: () => void, update: (state: MaintenanceState) => void) {
    const request = this.pending.then(async () => {
      checkActive();
      const state = await this.load();
      if (revision !== state.revision) throw new MaintenanceGuideError('conflict');
      update(state);
      state.revision += 1;
      const next = maintenanceStateSchema.safeParse(state);
      if (!next.success) throw new MaintenanceGuideError('invalidInput');
      if (Buffer.byteLength(JSON.stringify(next.data), 'utf8') > maximumStateBytes)
        throw new MaintenanceGuideError('fileTooLarge');
      checkActive();
      try {
        await writeJsonAtomicallyAsync(this.filePath, next.data);
      } catch {
        throw new MaintenanceGuideError('storageUnavailable');
      }
      return next.data;
    });
    this.pending = request.catch(() => undefined);
    return request;
  }

  mutate(input: MaintenanceMutation, checkActive: () => void) {
    return this.change(input.revision, checkActive, (state) => {
      if (input.kind === 'saveProject') {
        if (input.projectId) Object.assign(this.project(state, input.projectId), input.project);
        else state.projects.push({ ...input.project, id: randomUUID(), guides: [] });
      } else if (input.kind === 'removeProject') {
        this.project(state, input.projectId);
        state.projects = state.projects.filter((project) => project.id !== input.projectId);
      } else {
        const project = this.project(state, input.projectId);
        project.guides = project.guides.filter((guide) => guide.id !== input.guideId);
      }
    });
  }

  async importFile(filePath: string, revision: number, checkActive: () => void) {
    if (path.extname(filePath).toLowerCase() !== '.json') throw new MaintenanceGuideError('invalidInput');
    const parsed = maintenanceStateSchema.safeParse(
      JSON.parse((await readMaintenanceFile(filePath, maximumStateBytes)).text),
    );
    if (!parsed.success) throw new MaintenanceGuideError('invalidInput');
    return this.change(revision, checkActive, (state) => {
      for (const project of parsed.data.projects) {
        for (const guide of project.guides) approvedLocalPath(guide.path);
        state.projects.push({
          ...project,
          id: randomUUID(),
          guides: project.guides.map((guide) => ({ ...guide, id: randomUUID() })),
        });
      }
    });
  }
}
