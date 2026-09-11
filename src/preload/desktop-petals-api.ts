import { createContentLibraryBridge } from '@/preload/content-library-api';
import { codexContentStateSchema, codexProjectTargetSchema } from '@/shared/contracts/codex-content';
import { CODEX_CONTENT_APPLICATION_ID, contentApplicationSchema } from '@/shared/contracts/content-applications';
import {
  desktopNoteSchema,
  desktopPetalSnapshotSchema,
  petalPointSchema,
  type DesktopPetalsApi,
} from '@/shared/contracts/desktop-petals';
import { pinSourceSchema, pinSummarySchema } from '@/shared/contracts/petal-board';
import { petalQuotaSchema } from '@/shared/contracts/petal-hub';
import { petalLanguageSchema } from '@/shared/contracts/petal-language';
import { petalError, type PetalCommandResult } from '@/shared/petal-errors';
import { ipcRenderer } from 'electron';
import { z } from 'zod';
import { petalDrawerFrameSchema, petalDrawerPointerSchema } from '@/shared/contracts/petal-drawer';
import { petalPreviewSchema } from '@/shared/petal-preview';
import { petalPluckPointerSchema } from '@/shared/contracts/petal-pluck';

export function createDesktopPetalsApi(): DesktopPetalsApi {
  const command = async <T = unknown>(name: string, value?: unknown): Promise<T> => {
    const result: PetalCommandResult = await ipcRenderer.invoke('desktop-petals:command', name, value);
    if (!result.ok) throw petalError(result.code);
    return result.value as T;
  };
  const externalApplication = (input: unknown) =>
    command('content-application', {
      applicationId: CODEX_CONTENT_APPLICATION_ID,
      command: input,
    });
  // A window that failed before mounting an editor owns no unsaved input.
  // Register in preload so even a renderer boot/validation failure can acknowledge shutdown.
  let flushEditor: ((save?: boolean) => Promise<boolean>) | null = null;
  ipcRenderer.on('desktop-petals:flush', (_event, token: string, save?: boolean) => {
    void Promise.resolve()
      .then(() => (flushEditor ? flushEditor(save) : true))
      .catch(() => false)
      .then((saved) => command('flushed', { token, saved }))
      .catch(() => undefined);
  });
  return {
    files: async (input) => desktopNoteSchema.parse(await command('files', input)),
    preview: async (input) => petalPreviewSchema.nullable().parse(await command('preview', input)),
    drawer: (input) => command('drawer', input),
    onTitlesChanged(callback) {
      const listener = (_event: Electron.IpcRendererEvent, input: unknown) => {
        if (typeof input === 'boolean') callback(input);
      };
      ipcRenderer.on('desktop-petals:titles-changed', listener);
      return () => ipcRenderer.removeListener('desktop-petals:titles-changed', listener);
    },
    onDrawerPointer(callback) {
      const listener = (_event: Electron.IpcRendererEvent, input: unknown) => {
        const parsed = petalDrawerPointerSchema.safeParse(input);
        if (parsed.success) callback(parsed.data);
      };
      ipcRenderer.on('desktop-petals:drawer-pointer', listener);
      return () => ipcRenderer.removeListener('desktop-petals:drawer-pointer', listener);
    },
    onDrawerFrame(callback) {
      const listener = (_event: Electron.IpcRendererEvent, input: unknown) => {
        const parsed = petalDrawerFrameSchema.safeParse(input);
        if (parsed.success) callback(parsed.data);
      };
      ipcRenderer.on('desktop-petals:drawer-frame', listener);
      return () => ipcRenderer.removeListener('desktop-petals:drawer-frame', listener);
    },
    contentImageAccepted: (id) => command('content-image-accepted', id),
    contentImageStage: (input) => command('content-image-stage', input),
    contentImageResolve: (id) => command('content-image-resolve', id),
    externalApplications: {
      list: async () => z.array(contentApplicationSchema).parse(await command('content-applications')),
      command: (input) => command('content-application', input),
    },
    contentLibrary: createContentLibraryBridge((input) => command('content-library', input)),
    albums: async () => z.array(z.object({ id: z.string(), title: z.string() })).parse(await command('note-albums')),
    setAlbum: async (input) => desktopNoteSchema.parse(await command('note-album', input)),
    references: async (input) =>
      input.kind === 'search'
        ? z.array(pinSummarySchema).parse(await command('references', input))
        : desktopNoteSchema.parse(await command('references', input)),
    codex: {
      onChanged(callback) {
        const listener = (_event: Electron.IpcRendererEvent, input: unknown) => {
          const parsed = z.object({ stashId: z.string() }).safeParse(input);
          callback(parsed.success ? parsed.data : undefined);
        };
        ipcRenderer.on('desktop-petals:content-changed', listener);
        return () => ipcRenderer.removeListener('desktop-petals:content-changed', listener);
      },
      command: (input) => externalApplication(input),
      state: async (stashId) => codexContentStateSchema.parse(await externalApplication({ kind: 'state', stashId })),
      projects: async (fresh) =>
        z.array(codexProjectTargetSchema).parse(await externalApplication({ kind: 'projects', fresh })),
    },
    onNavigate(callback) {
      const schema = z.object({
        libraryId: z.string(),
        kind: z.enum(['CODEX', 'CODEX_SETTINGS', 'ALBUM', 'MATERIAL', 'SOURCE']),
        id: z.string().nullable(),
      });
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const parsed = schema.safeParse(value);
        if (parsed.success) callback(parsed.data);
      };
      ipcRenderer.on('desktop-petals:navigate', listener);
      return () => ipcRenderer.removeListener('desktop-petals:navigate', listener);
    },
    boardCommand: (input) => command('board', input),
    searchPinSources: async (input) => z.array(pinSummarySchema).parse(await command('pin-search', input)),
    pluckPreview: (active) => command('pluck-preview', active),
    pluckWatch: (token, active) => command('pluck-watch', { token, active }),
    onPluckPointer(callback) {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const result = petalPluckPointerSchema.safeParse(value);
        if (result.success) callback(result.data);
      };
      ipcRenderer.on('desktop-petals:pluck-pointer', listener);
      return () => ipcRenderer.removeListener('desktop-petals:pluck-pointer', listener);
    },
    pluckPosition: async (point, pointer) =>
      petalPointSchema.parse(await command('pluck-position', { point, pointer })),
    revealDock: (expanded) => command('dock-reveal', expanded),
    setMenuOpen: async (open, point) => petalPointSchema.parse(await command('menu-open', { open, point })),
    onMenuRequested(callback) {
      const listener = () => callback();
      ipcRenderer.on('desktop-petals:menu-requested', listener);
      return () => ipcRenderer.removeListener('desktop-petals:menu-requested', listener);
    },
    onOpenPin(callback) {
      const schema = z.object({ libraryId: z.string(), source: pinSourceSchema });
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const result = schema.safeParse(value);
        if (result.success) callback(result.data);
      };
      ipcRenderer.on('desktop-petals:open-pin', listener);
      return () => ipcRenderer.removeListener('desktop-petals:open-pin', listener);
    },
    language: async () => petalLanguageSchema.parse(await command('language')),
    setLanguage: (language) => command('set-language', petalLanguageSchema.parse(language)),
    onLanguageChanged(callback) {
      const listener = (_event: Electron.IpcRendererEvent, value: unknown) => {
        const result = petalLanguageSchema.safeParse(value);
        if (result.success) callback(result.data);
      };
      ipcRenderer.on('desktop-petals:language-changed', listener);
      return () => ipcRenderer.removeListener('desktop-petals:language-changed', listener);
    },
    show: () => command('show'),
    showAll: () => command('show-all'),
    hideAll: () => command('hide-all'),
    hidePetals: () => command('hide-petals'),
    cleanup: (color) => command('cleanup', color),
    reload: () => command('reload'),
    hubView: (view) => command('hub-view', view),
    configureHub: (settings) => command('configure-hub', settings),
    timerAction: (action) => command('timer-action', action),
    hubQuota: async () => petalQuotaSchema.parse(await command('hub-quota')),
    snapshot: async () => desktopPetalSnapshotSchema.parse(await command('snapshot')),
    rendered: () => command('rendered'),
    create: async (input) => desktopNoteSchema.parse(await command('create', input)),
    open: (id) => command('open', id),
    save: async (input) => desktopNoteSchema.parse(await command('save', input)),
    checkpoint: (input) => command('checkpoint', input),
    appearance: async (input) => desktopNoteSchema.parse(await command('appearance', input)),
    expand: (expanded) => command('expand', expanded),
    setAlwaysOnTop: (alwaysOnTop) => command('always-on-top', alwaysOnTop),
    undoCollection: (token) => command('undo-collection', token),
    resize: (size) => command('resize', size),
    hide: () => command('hide'),
    remove: () => command('remove'),
    move: (point) => command('move', point),
    openMain: () => command('main'),
    beginDrag: (point) => command('begin-drag', point),
    endDrag: (cancel, released = false, point) => command('end-drag', { cancel, released, point }),
    onChanged(callback) {
      const listener = () => callback();
      ipcRenderer.on('desktop-petals:changed', listener);
      return () => ipcRenderer.removeListener('desktop-petals:changed', listener);
    },
    onSourceChanged(callback) {
      const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) => callback(value);
      ipcRenderer.on('desktop-petals:source-changed', listener);
      return () => ipcRenderer.removeListener('desktop-petals:source-changed', listener);
    },
    onFlush(callback) {
      flushEditor = callback;
      return () => {
        if (flushEditor === callback) flushEditor = null;
      };
    },
  };
}
