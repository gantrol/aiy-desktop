import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CalendarCapturedEvent } from '@/main/database/calendar/calendar-file-capture';
import { readPetalLayoutFile, writePetalLayoutFile } from '@/main/desktop-petals/petal-layout-file';
import { PETAL_DRAWER_ENABLED, petalDrawerLayoutSchema, type PetalDrawerLayout } from '@/shared/contracts/petal-drawer';
import { petalPointSchema, petalNoteSizeSchema } from '@/shared/contracts/desktop-petals';
import { isContentPinId } from '@/shared/contracts/petal-board';
import {
  canRevealPetal,
  hidePetalByHub,
  revealPetalByHub,
  normalizePetalVisibility,
  setPetalVisibility,
} from '@/shared/petal-visibility';
import {
  petalHubSettingsSchema,
  petalTimerSchema,
  type PetalHubSettings,
  type PetalTimer,
} from '@/shared/contracts/petal-hub';

const placementSchema = petalPointSchema.extend({
  visible: z.boolean(),
  hiddenByHub: z.boolean().optional(),
  expanded: z.boolean(),
  home: z.enum(['desktop', 'drawer']).default('desktop'),
  noteSize: petalNoteSizeSchema.optional(),
  dockEdge: z.enum(['left', 'right', 'top', 'bottom']).optional(),
});
const calendarEventSchema = z.object({
  id: z.string().uuid(),
  libraryId: z.string().min(1).max(200),
  entityType: z.enum(['DESKTOP_NOTE_INSTANCE', 'DESKTOP_CONTENT_PIN', 'PETAL_LAYER']),
  entityId: z.string().min(1).max(200),
  operation: z.enum(['SHOW', 'HIDE', 'TEMPORARY_HIDE', 'COLLECT', 'MOVE_TO_DRAWER', 'MOVE_TO_DESKTOP']),
  observedAt: z.string().datetime(),
});
type PetalCalendarEvent = z.infer<typeof calendarEventSchema>;
export interface PetalCalendarCapture {
  include(libraryId: string, entityType: PetalCalendarEvent['entityType'], entityId: string): boolean;
  record(libraryId: string, events: readonly CalendarCapturedEvent[]): boolean;
}
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
  calendarEvents: z.array(calendarEventSchema).default([]),
});
export type PetalPlacement = z.infer<typeof placementSchema>;
type LayoutState = z.infer<typeof stateSchema>;

function visibilitySnapshot(state: LayoutState) {
  return {
    libraries: Object.fromEntries(
      Object.entries(state.libraries).map(([libraryId, placements]) => [
        libraryId,
        Object.fromEntries(
          Object.entries(placements).map(([id, placement]) => [
            id,
            { visible: placement.visible, hiddenByHub: placement.hiddenByHub === true, home: placement.home },
          ]),
        ),
      ]),
    ),
    hiddenLayers: Object.fromEntries(
      Object.entries(state.boards).map(([libraryId, board]) => [libraryId, new Set(board.hiddenLayerIds)]),
    ),
  };
}

/** Machine-local placement and visibility intent; content and appearance belong to the library. */
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

  async commit(
    libraryId: string,
    changes: Record<string, PetalPlacement>,
    drawer = this.drawer(libraryId),
    visibilityIntent: 'explicit' | 'hub' = 'explicit',
  ) {
    return this.enqueue(() => this.commitNow(libraryId, changes, drawer, visibilityIntent));
  }

  /** Compute from the latest intent inside the write queue, not a stale UI snapshot. */
  transitionVisibility(libraryId: string, ids: readonly string[], action: 'temporary' | 'restore' | 'collect') {
    return this.enqueue(async () => {
      const changes: Record<string, PetalPlacement> = {};
      for (const id of new Set(ids)) {
        const place = this.get(libraryId, id);
        if (!place || place.home !== 'desktop') continue;
        if (action !== 'collect' && !canRevealPetal(place)) continue;
        changes[id] =
          action === 'temporary'
            ? hidePetalByHub(place)
            : action === 'restore'
              ? revealPetalByHub(place)
              : setPetalVisibility(place, false);
      }
      if (Object.keys(changes).length) await this.commitNow(libraryId, changes, this.drawer(libraryId), 'hub');
    });
  }

  private async commitNow(
    libraryId: string,
    changes: Record<string, PetalPlacement>,
    drawer: PetalDrawerLayout,
    visibilityIntent: 'explicit' | 'hub',
  ) {
    const updates = Object.fromEntries(
      Object.entries(changes).map(([id, place]) => [
        id,
        placementSchema.parse(
          visibilityIntent === 'hub' ? normalizePetalVisibility(place) : setPetalVisibility(place, place.visible),
        ),
      ]),
    );
    const previous = { ...this.placements(libraryId) };
    const oldDrawer = this.state.drawers[libraryId];
    const nextDrawer = petalDrawerLayoutSchema.parse(drawer);
    this.state.libraries[libraryId] = { ...previous, ...updates };
    this.state.drawers[libraryId] = nextDrawer;
    try {
      await this.write();
    } catch (error) {
      // Roll back only this transaction's fields, preserving independent window movements.
      const library = this.placements(libraryId);
      for (const [id, next] of Object.entries(updates)) {
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
  private state: LayoutState = stateSchema.parse({ schemaVersion: 1, libraries: {} });
  private savedVisibility = visibilitySnapshot(this.state);
  private writes: Promise<void> = Promise.resolve();
  private readonly file: string;
  constructor(
    userDataRoot: string,
    private readonly calendar?: PetalCalendarCapture,
  ) {
    this.file = path.join(userDataRoot, 'ui-state', 'desktop-petals.v1.json');
  }
  async load() {
    const saved = await readPetalLayoutFile(this.file, (value) => stateSchema.parse(value));
    if (saved) this.state = saved;
    let changed = false;
    if (!PETAL_DRAWER_ENABLED) {
      for (const library of Object.values(this.state.libraries)) {
        for (const [id, placement] of Object.entries(library)) {
          if (placement.home !== 'drawer') continue;
          library[id] = { ...placement, home: 'desktop', visible: false, hiddenByHub: false, expanded: false };
          changed = true;
        }
      }
    }
    // Loading and compatibility normalization establish a baseline; neither is a new user action.
    this.savedVisibility = visibilitySnapshot(this.state);
    if (changed) await this.flush();
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
    library[instanceId] = placementSchema.parse(normalizePetalVisibility(placement));
  }
  flush() {
    return this.enqueue(() => this.write());
  }
  replayCalendarEvents() {
    return this.enqueue(async () => this.deliverCalendarEvents());
  }
  private enqueue(write: () => Promise<void>) {
    this.writes = this.writes.catch(() => undefined).then(write);
    return this.writes;
  }
  private captureVisibility(next: LayoutState) {
    const events: PetalCalendarEvent[] = [];
    const observedAt = new Date().toISOString();
    const add = (
      libraryId: string,
      entityType: PetalCalendarEvent['entityType'],
      entityId: string,
      operation: PetalCalendarEvent['operation'],
    ) => {
      if (!this.calendar) return;
      try {
        if (!this.calendar.include(libraryId, entityType, entityId)) return;
      } catch (error) {
        // Source verification may be temporarily unavailable; preserve the saved intent for later delivery.
        console.warn('[desktop-petals] calendar source verification deferred', { libraryId, error });
      }
      events.push({ id: randomUUID(), libraryId, entityType, entityId, operation, observedAt });
    };
    for (const [libraryId, placements] of Object.entries(next.libraries)) {
      const previous = this.savedVisibility.libraries[libraryId];
      for (const [id, placement] of Object.entries(placements)) {
        const before = previous?.[id];
        // Instance creation already has a source event. The hub is not a library content instance.
        if (!before || id === 'hub') continue;
        const type = isContentPinId(id) ? 'DESKTOP_CONTENT_PIN' : 'DESKTOP_NOTE_INSTANCE';
        if (before.home !== placement.home)
          add(libraryId, type, id, placement.home === 'drawer' ? 'MOVE_TO_DRAWER' : 'MOVE_TO_DESKTOP');
        else if (before.visible !== placement.visible || before.hiddenByHub !== (placement.hiddenByHub === true))
          add(libraryId, type, id, placement.visible ? 'SHOW' : placement.hiddenByHub ? 'TEMPORARY_HIDE' : 'COLLECT');
      }
    }
    for (const [libraryId, board] of Object.entries(next.boards)) {
      const before = this.savedVisibility.hiddenLayers[libraryId] ?? new Set<string>();
      const after = new Set(board.hiddenLayerIds);
      for (const id of after) if (!before.has(id)) add(libraryId, 'PETAL_LAYER', id, 'HIDE');
      for (const id of before) if (!after.has(id)) add(libraryId, 'PETAL_LAYER', id, 'SHOW');
    }
    return events;
  }
  private deliverCalendarEvents() {
    const delivered = new Set<string>();
    const libraries = new Set(this.state.calendarEvents.map((event) => event.libraryId));
    for (const libraryId of libraries) {
      const events = this.state.calendarEvents.filter((event) => event.libraryId === libraryId);
      try {
        if (this.calendar?.record(libraryId, events)) for (const event of events) delivered.add(event.id);
      } catch (error) {
        // A committed placement remains committed. Its durable receipt is retried after a later write or activation.
        console.warn('[desktop-petals] calendar capture pending', { libraryId, error });
      }
    }
    this.state.calendarEvents = this.state.calendarEvents.filter((event) => !delivered.has(event.id));
  }
  private async write() {
    const snapshot = structuredClone(this.state);
    snapshot.calendarEvents.push(...this.captureVisibility(snapshot));
    // Save intent and receipts in the same atomic file replacement before touching SQLite.
    await writePetalLayoutFile(this.file, snapshot);
    this.savedVisibility = visibilitySnapshot(snapshot);
    this.state.calendarEvents = snapshot.calendarEvents;
    this.deliverCalendarEvents();
  }
}
