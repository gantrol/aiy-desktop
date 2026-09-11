import { mkdir, open, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { PETAL_DRAWER_ENABLED, petalDrawerLayoutSchema, type PetalDrawerLayout } from '@/shared/contracts/petal-drawer';
import { petalPointSchema, petalNoteSizeSchema } from '@/shared/contracts/desktop-petals';
import {
  petalHubSettingsSchema,
  petalTimerSchema,
  type PetalHubSettings,
  type PetalTimer,
} from '@/shared/contracts/petal-hub';

const placementSchema = petalPointSchema.extend({
  visible: z.boolean(),
  expanded: z.boolean(),
  home: z.enum(['desktop', 'drawer']).default('desktop'),
  noteSize: petalNoteSizeSchema.optional(),
  dockEdge: z.enum(['left', 'right', 'top', 'bottom']).optional(),
});
const stateSchema = z.object({
  schemaVersion: z.literal(1),
  titlesVisible: z.boolean().default(true),
  drawers: z.record(z.string(), petalDrawerLayoutSchema).default({}),
  libraries: z.record(z.string(), z.record(z.string(), placementSchema)),
  hubSettings: petalHubSettingsSchema.default(() =>
    petalHubSettingsSchema.parse({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  ),
  timer: petalTimerSchema.default(() => petalTimerSchema.parse({})),
  boards: z
    .record(z.string(), z.object({ activeLayerId: z.string(), hiddenLayerIds: z.array(z.string()) }))
    .default({}),
});
export type PetalPlacement = z.infer<typeof placementSchema>;

/** Machine-local geometry only; content and appearance belong to the library. */
export class PetalLayoutStore {
  get titlesVisible() {
    return this.state.titlesVisible;
  }
  toggleTitles() {
    return this.enqueue(async () => {
      const previous = this.state.titlesVisible;
      this.state.titlesVisible = !previous;
      try {
        await this.write();
      } catch (error) {
        this.state.titlesVisible = previous;
        throw error;
      }
    });
  }
  drawer(libraryId: string): PetalDrawerLayout {
    return this.state.drawers[libraryId] ?? petalDrawerLayoutSchema.parse({});
  }
  placements(libraryId: string) {
    return this.state.libraries[libraryId] ?? {};
  }
  async commit(libraryId: string, changes: Record<string, PetalPlacement>, drawer = this.drawer(libraryId)) {
    return this.enqueue(async () => {
      const previous = { ...this.placements(libraryId) };
      const oldDrawer = this.state.drawers[libraryId];
      const nextDrawer = petalDrawerLayoutSchema.parse(drawer);
      this.state.libraries[libraryId] = { ...previous, ...changes };
      this.state.drawers[libraryId] = nextDrawer;
      try {
        await this.write();
      } catch (error) {
        // Geometry may change while the async write is running. Roll back only
        // this transaction's fields, preserving independent window movements.
        const library = this.placements(libraryId);
        for (const [id, next] of Object.entries(changes)) {
          const current = library[id],
            before = previous[id];
          if (!current) continue;
          if (!before) {
            delete library[id];
            continue;
          }
          const restored = { ...current };
          for (const key of Object.keys(next) as (keyof PetalPlacement)[])
            if (current[key] === next[key]) Object.assign(restored, { [key]: before[key] });
          library[id] = restored;
        }
        if (this.state.drawers[libraryId] === nextDrawer) {
          if (oldDrawer) this.state.drawers[libraryId] = oldDrawer;
          else delete this.state.drawers[libraryId];
        }
        throw error;
      }
    });
  }
  board(libraryId: string) {
    return this.state.boards[libraryId] ?? { activeLayerId: 'default', hiddenLayerIds: [] };
  }
  async saveBoard(libraryId: string, board: { activeLayerId: string; hiddenLayerIds: string[] }) {
    const previous = this.state.boards[libraryId];
    this.state.boards[libraryId] = board;
    try {
      await this.flush();
    } catch (error) {
      if (previous) this.state.boards[libraryId] = previous;
      else delete this.state.boards[libraryId];
      throw error;
    }
  }
  private state: z.infer<typeof stateSchema> = stateSchema.parse({ schemaVersion: 1, libraries: {} });
  private writes: Promise<void> = Promise.resolve();
  private readonly file: string;
  constructor(userDataRoot: string) {
    this.file = path.join(userDataRoot, 'ui-state', 'desktop-petals.v1.json');
  }
  async load() {
    let handle;
    try {
      handle = await open(this.file, 'r');
      if ((await handle.stat()).size > 1_048_576) throw new Error('Desktop petal settings exceed the size limit');
      this.state = stateSchema.parse(JSON.parse(await handle.readFile('utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    } finally {
      await handle?.close();
    }
    if (!PETAL_DRAWER_ENABLED) {
      let changed = false;
      for (const library of Object.values(this.state.libraries)) {
        for (const [id, placement] of Object.entries(library)) {
          if (placement.home !== 'drawer') continue;
          // Retain content, geometry and layer membership without opening every
          // formerly stored note. My Petals can reveal each instance on demand.
          library[id] = { ...placement, home: 'desktop', visible: false, expanded: false };
          changed = true;
        }
      }
      if (changed) await this.flush();
    }
  }
  get(libraryId: string, instanceId: string) {
    return this.state.libraries[libraryId]?.[instanceId];
  }
  get hubSettings() {
    return this.state.hubSettings;
  }
  remove(libraryId: string, instanceId: string) {
    const library = this.state.libraries[libraryId];
    if (library) delete library[instanceId];
    const drawer = this.state.drawers[libraryId];
    if (drawer) {
      drawer.order = drawer.order.filter((id) => id !== instanceId);
      if (drawer.anchorId === instanceId) drawer.anchorId = null;
    }
  }
  migrateArticlePins(libraryId: string, activeIds: readonly string[]) {
    const library = this.state.libraries[libraryId];
    if (!library) return;
    const drawer = this.state.drawers[libraryId];
    for (const id of activeIds) {
      if (!id.startsWith('article:')) continue;
      const previous = 'pin:' + id.slice('article:'.length);
      if (library[previous] && !library[id]) library[id] = library[previous];
      delete library[previous];
      if (drawer) {
        drawer.order = drawer.order.map((value) => (value === previous ? id : value));
        if (drawer.anchorId === previous) drawer.anchorId = id;
      }
    }
  }
  prune(libraryId: string, activeIds: readonly string[]) {
    const active = new Set(['hub', ...activeIds]);
    for (const id of Object.keys(this.state.libraries[libraryId] ?? {}))
      if (!active.has(id)) this.remove(libraryId, id);
  }
  get timer() {
    return this.state.timer;
  }
  async saveHub(settings: PetalHubSettings, timer: PetalTimer) {
    const previous = { ...this.state };
    this.state = {
      ...this.state,
      hubSettings: petalHubSettingsSchema.parse(settings),
      timer: petalTimerSchema.parse(timer),
    };
    try {
      await this.flush();
    } catch (error) {
      this.state = { ...this.state, hubSettings: previous.hubSettings, timer: previous.timer };
      throw error;
    }
  }
  set(libraryId: string, instanceId: string, placement: PetalPlacement) {
    const library = (this.state.libraries[libraryId] ??= {});
    library[instanceId] = placementSchema.parse(placement);
  }
  flush() {
    return this.enqueue(() => this.write());
  }
  private enqueue(write: () => Promise<void>) {
    this.writes = this.writes.catch(() => undefined).then(write);
    return this.writes;
  }
  private async write() {
    const content = JSON.stringify(this.state);
    await mkdir(path.dirname(this.file), { recursive: true });
    const pending = `${this.file}.pending`;
    await writeFile(pending, content, { encoding: 'utf8', mode: 0o600 });
    await rename(pending, this.file);
  }
}
