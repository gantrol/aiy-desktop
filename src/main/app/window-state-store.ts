import path from 'node:path';
import { z } from 'zod';
import { readBoundedJsonWithBackup, writeJsonAtomically } from '@/main/app/atomic-json-file';

const windowBoundsSchema = z
  .object({
    x: z.number().int().min(-100_000).max(100_000),
    y: z.number().int().min(-100_000).max(100_000),
    width: z.number().int().positive().max(32_768),
    height: z.number().int().positive().max(32_768),
  })
  .strict();

const persistedWindowStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    normalBounds: windowBoundsSchema,
    maximized: z.boolean(),
  })
  .strict();

export type PersistedWindowState = z.infer<typeof persistedWindowStateSchema>;

export class WindowStateStore {
  private readonly filePath: string;

  constructor(userDataRoot: string) {
    this.filePath = path.join(userDataRoot, 'ui-state', 'window-state.v1.json');
  }

  load(): PersistedWindowState | null {
    const parsed = persistedWindowStateSchema.safeParse(readBoundedJsonWithBackup(this.filePath, 16 * 1024));
    return parsed.success ? parsed.data : null;
  }

  save(state: PersistedWindowState) {
    writeJsonAtomically(this.filePath, persistedWindowStateSchema.parse(state));
  }
}
