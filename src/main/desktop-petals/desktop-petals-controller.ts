import { desktopPetalSnapshot } from '@/main/desktop-petals/petal-snapshot';
import { observePetalFlush } from '@/main/desktop-petals/petal-flush-observations';
import type { PendingPetalFlush } from '@/main/desktop-petals/petal-flush-request';
import { petalFlushReportSchema } from '@/shared/contracts/petal-workspace';
import { queuePetalWorkspace } from '@/main/desktop-petals/petal-workspace-service';
import { executePetalAssetFile } from '@/main/desktop-petals/petal-asset-file-actions';
import { flushPetalInput } from '@/main/desktop-petals/petal-editor-flush';
import { createPetalNote } from '@/main/desktop-petals/petal-create-command';
import { executePetalHubCommand, hubCommands } from '@/main/desktop-petals/petal-hub-commands';
import { removePetalPlacement } from '@/main/desktop-petals/petal-note-removal';
import { executePetalPreview } from '@/main/desktop-petals/petal-content-preview';
import { contentImageImports } from '@/main/creations/content-image-imports';
import { linkPreviews, openLinkCard } from '@/main/links/link-preview-service';
import { PetalBoardService } from '@/main/desktop-petals/petal-board-service';
import { PetalHubService } from '@/main/desktop-petals/petal-hub-service';
import { openPetalSourceWindow } from '@/main/desktop-petals/petal-source-window';
import { PetalLayoutStore } from '@/main/desktop-petals/petal-layout-store';
import { createPetalCalendarCapture } from '@/main/desktop-petals/petal-calendar-capture';
import { PetalNoteService } from '@/main/desktop-petals/petal-note-service';
import { changePetalReferences } from '@/main/desktop-petals/petal-references';
import { executeNoteFiles } from '@/main/desktop-petals/petal-files';
import {
  openPetalNote,
  expandPetalNote,
  canRestorePetalVisibility,
} from '@/main/desktop-petals/petal-note-presentation';
import { observePetalPins, observePetalSources } from '@/main/desktop-petals/petal-source-observer';
import { executePetalDrag, type PetalDrag } from '@/main/desktop-petals/petal-window-drag';
import { PetalWindows, type PetalWindow } from '@/main/desktop-petals/petal-windows';
import { ContentApplicationRegistry } from '@/main/extensions/content-application-registry';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { codexContentCommandSchema, type CodexContentCommand } from '@/shared/contracts/codex-content';
import { CODEX_CONTENT_APPLICATION_ID } from '@/shared/contracts/content-applications';
import { contentImageImportIdSchema, contentImageStageSchema } from '@/shared/contracts/content-image-import';
import { contentLibraryCommandSchema } from '@/shared/contracts/content-library';
import { copyLibraryReference } from '@/main/creations/content-reference-clipboard';
import {
  desktopNoteAppearanceSchema,
  desktopNoteDraftSchema,
  desktopNoteSaveSchema,
  petalNoteSizeSchema,
  petalPointSchema,
  petalReferenceCommandSchema,
  type DesktopPetalSnapshot,
} from '@/shared/contracts/desktop-petals';
import { isContentPinId, petalBoardCommandSchema, pinSearchSchema } from '@/shared/contracts/petal-board';
import { petalLanguageSchema, type PetalLanguage } from '@/shared/contracts/petal-language';
import { CODEX_EXTENSION_ID } from '@/shared/extension-ids';
import { EXTENSION_PERMISSION } from '@/shared/extension-permissions';
import { desktopPetalMessages } from '@/shared/i18n/desktop-petals';
import { PetalError, petalError, type PetalCommandResult } from '@/shared/petal-errors';
import { app, ipcMain, Notification, screen, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { PetalDrawerService } from '@/main/desktop-petals/petal-drawer-service';
import { petalDrawerCommandSchema } from '@/shared/contracts/petal-drawer';
import { z } from 'zod';

import { createPetalTrayBridge } from '@/main/desktop-petals/petal-tray-bridge';

interface Options {
  userDataRoot: string;
  getMainWindow(): BrowserWindow | null;
  getContext(): ActiveLibraryContext | null;
  allowPresentation: boolean;
  onTrayStateChanged(): void;
}
const noteCommands = new Set(['save', 'checkpoint', 'appearance']);

/** Owns a narrow IPC surface. Petal windows never receive the main-window API. */
export class DesktopPetalsController {
  private readonly windows: PetalWindows;
  private readonly ready: Promise<void>;
  private readonly hub: PetalHubService;
  private readonly drawer: PetalDrawerService;
  private suspended = false;
  private restorePromise: Promise<void> | null = null;
  private language: PetalLanguage = { locale: 'en', messages: desktopPetalMessages };
  private notes: PetalNoteService | null = null;
  private unsubscribeSources: (() => void) | null = null;
  private unsubscribePins: (() => void) | null = null;
  private unsubscribeContent: (() => void) | null = null;
  private board: PetalBoardService | null = null;
  private dragOrigins = new Map<number, PetalDrag>();
  private pendingFlushes = new Map<string, PendingPetalFlush>();
  constructor(private readonly options: Options) {
    const layouts = new PetalLayoutStore(options.userDataRoot, createPetalCalendarCapture(options.getContext));
    this.ready = layouts.load();
    void this.ready.catch((error) => console.error('[desktop-petals] settings unavailable', error));
    this.hub = new PetalHubService(layouts, (phase) => {
      this.changed();
      if (options.allowPresentation && layouts.hubSettings.timerNotification && Notification.isSupported()) {
        const notification = new Notification({
          title: this.language.messages.timer[phase],
          body: this.language.messages.timer.done,
        });
        notification.on('click', () => {
          const context = options.getContext();
          if (context?.state === 'ACTIVE')
            void this.windows
              .show(context.library.id, null)
              .then((entry) => this.windows.showHubView(entry, 'flower'))
              .catch((error) => console.error('[desktop-petals] timer reveal failed', error));
        });
        notification.show();
      }
    });
    void this.ready.then(() => this.hub.scheduler.refresh()).catch(() => undefined);
    app.once('will-quit', () => this.hub.scheduler.dispose());
    this.windows = new PetalWindows(
      layouts,
      options.allowPresentation,
      async (entry) => {
        if (!(await this.flushEntry(entry))) return false;
        if (entry.instanceId && this.notes?.isPending(entry.instanceId)) {
          this.removeNoteWindow(entry.libraryId, entry.instanceId);
          await this.windows.flush();
          return false;
        }
        return true;
      },
      (entry) => {
        if (entry.hubView === 'flower') entry.window.webContents.send('desktop-petals:menu-requested');
      },
      (isNote) => (isNote ? this.language.messages.note.windowTitle : this.language.messages.flower.title),
    );
    this.windows.canRestoreVisibility = (entry) =>
      canRestorePetalVisibility(entry, this.options.getContext(), this.suspended, this.notes, this.board);
    this.drawer = new PetalDrawerService(this.windows, {
      context: () => this.context(),
      board: () => this.board!.snapshot(),
      flush: (entry) => this.flushEntry(entry, true),
      pending: (id) => this.notes?.isPending(id) ?? false,
      discard: (id) => this.removeNoteWindow(this.context().library.id, id),
      remove: async (id) => {
        if (isContentPinId(id)) await this.board!.run({ kind: 'unpin', id });
        else {
          this.context().database.removeDesktopNote(id);
          this.removeNoteWindow(this.context().library.id, id);
          await this.windows.flush();
        }
      },
      changed: () => this.changed(),
      title: () => this.language.messages.drawer.title,
    });
    this.windows.onDragMove = (entry, point) => this.drawer.observeDrop(entry, point);
    this.windows.onDragEnd = (entry, point) => this.drawer.drop(entry, point);
    this.windows.onDragCancel = () => this.drawer.view.clearDrop();
    void this.ready.then(() => this.windows.startInput()).catch(() => undefined);
    app.once('will-quit', () => this.drawer.view.dispose());
    ipcMain.handle(
      'desktop-petals:command',
      async (event, command: unknown, input: unknown): Promise<PetalCommandResult> => {
        try {
          return { ok: true, value: await this.invoke(event, command, input) };
        } catch (error) {
          // Expected domain failures cross IPC as data; unexpected failures keep Electron's diagnostics.
          if (error instanceof PetalError) return { ok: false, code: error.code };
          throw error;
        }
      },
    );
  }
  readonly tray = createPetalTrayBridge({
    ready: () => this.ready,
    available: () =>
      this.options.allowPresentation &&
      !this.suspended &&
      !this.restorePromise &&
      Boolean(this.notes && this.board) &&
      this.options.getContext()?.state === 'ACTIVE',
    context: () => this.context(),
    execute: (command, input, context) => this.executeHub(command, input, context),
    changed: () => this.options.onTrayStateChanged(),
  });
  private sender(event: IpcMainInvokeEvent) {
    const entry = this.windows.entries.get(event.sender.id);
    const main = this.options.getMainWindow();
    if (event.senderFrame !== event.sender.mainFrame || (!entry && event.sender !== main?.webContents))
      throw new Error('Rejected desktop petal sender');
    return entry;
  }
  private context(entry?: PetalWindow) {
    const context = this.options.getContext();
    if (context && entry && entry.libraryId !== context.library.id) throw petalError('wrongLibrary');
    if (!context || context.state !== 'ACTIVE') throw petalError('libraryUnavailable');
    return context;
  }
  private async invoke(event: IpcMainInvokeEvent, rawCommand: unknown, input: unknown): Promise<unknown> {
    const entry = this.sender(event);
    const command = z.string().parse(rawCommand);
    if (command === 'rendered') {
      if (!entry) throw petalError('hubOnly');
      this.windows.rendered(entry);
      return;
    }
    if (command === 'language') return this.language;
    if (command === 'set-language') {
      if (entry) throw new Error('Only the main UI can change the application language');
      this.language = petalLanguageSchema.parse(input);
      this.windows.setLanguage(this.language);
      return;
    }
    if (command === 'flushed') {
      const result = z
        .object({ token: z.string(), saved: z.boolean(), report: petalFlushReportSchema.optional() })
        .strict()
        .parse(input);
      const pending = this.pendingFlushes.get(result.token);
      if (pending?.senderId === event.sender.id) pending.finish(result.saved, result.report);
      return;
    }
    // Releasing temporary menu bounds must also work while the library is draining.
    if (command === 'pluck-watch' && input && typeof input === 'object' && 'active' in input && input.active === false)
      return this.executePresentation(command, input, entry);
    if (command === 'menu-open' && input && typeof input === 'object' && 'open' in input && input.open === false)
      return this.executePresentation(command, input, entry);
    if (command === 'preview' && input && typeof input === 'object' && 'open' in input && input.open === false)
      return this.preview(input, entry);
    await this.ready;
    const context = this.context(entry);
    if (this.suspended && !['save', 'checkpoint', 'snapshot'].includes(command)) throw petalError('saving');
    const release = context.acquireOperation();
    try {
      return await this.execute(command, input, event.sender.id, context, entry);
    } finally {
      release();
    }
  }
  private createNote(input: unknown, context: ActiveLibraryContext, entry?: PetalWindow) {
    return createPetalNote(
      {
        windows: this.windows,
        notes: this.notes!,
        board: this.board!,
        changed: () => this.changed(),
        publishSource: (library, id) => this.publishSource(library, id),
      },
      input,
      context,
      entry,
    );
  }
  private preview(input: unknown, entry?: PetalWindow) {
    const { windows, drawer, notes, board, dragOrigins } = this;
    const dragging = Boolean(entry && dragOrigins.has(entry.window.webContents.id));
    return executePetalPreview(input, entry, windows, drawer, notes, () => board!.snapshot(), dragging);
  }
  private async execute(
    command: string,
    input: unknown,
    senderId: number,
    context: ActiveLibraryContext,
    entry?: PetalWindow,
  ) {
    if (command === 'drawer') return this.drawer.run(petalDrawerCommandSchema.parse(input), entry);
    if (command === 'preview') return this.preview(input, entry);
    if (
      entry?.drawer &&
      !['snapshot', 'open', 'create', 'hub-view', 'show', 'main', 'board', 'appearance'].includes(command)
    )
      throw petalError('hubOnly');
    if (command === 'asset-file') return executePetalAssetFile(context, input, entry, this.notes!, this.board!);
    if (command === 'board') return this.place(context, async () => this.executeBoard(command, input, context, entry));
    if (command === 'pin-search') return this.executeBoard(command, input, context, entry);
    if (command === 'note-albums' || command === 'note-album')
      return this.executeNoteAlbum(command, input, context, entry);
    if (command === 'content-action') return this.executeContentAction(input, context, entry);
    if (command === 'content-applications') return this.contentApplications(context, entry).list();
    if (command === 'content-application') return this.contentApplications(context, entry).execute(input);
    if (command === 'references') return this.executeReferences(input, context, entry);
    if (command === 'files')
      return executeNoteFiles(context.database, this.notes, entry, input, (note) => {
        this.board!.registerNote(note.id, true);
        this.publishSource(context, note.id);
        this.changed();
      });
    if (command === 'content-library') return this.executeContentLibrary(input, context);
    if (
      command === 'pluck-preview' ||
      command === 'pluck-watch' ||
      command === 'pluck-position' ||
      command === 'dock-reveal' ||
      command === 'menu-open'
    )
      return this.executePresentation(command, input, entry);
    if (['begin-drag', 'move', 'end-drag'].includes(command))
      return executePetalDrag(this.windows, this.dragOrigins, command, input, senderId, entry);
    if (hubCommands.has(command)) return this.executeHub(command, input, context, entry);
    if (
      noteCommands.has(command) ||
      ['content-image-stage', 'content-image-resolve', 'content-image-accepted'].includes(command)
    )
      return this.executeNote(command, input, context, entry);
    if (['open', 'create', 'hide', 'remove'].includes(command))
      return this.place(context, () => this.executeWindow(command, input, context, entry));
    return this.executeWindow(command, input, context, entry);
  }
  private place<T>(context: ActiveLibraryContext, action: () => T | Promise<T>): Promise<T> {
    return queuePetalWorkspace(this.windows, async () => {
      if (this.options.getContext() !== context || context.state !== 'ACTIVE') throw petalError('libraryUnavailable');
      if (this.suspended) throw petalError('saving');
      return action();
    });
  }
  private async executeWindow(command: string, input: unknown, context: ActiveLibraryContext, entry?: PetalWindow) {
    switch (command) {
      case 'show':
        this.windows.showHubView(await this.windows.show(context.library.id, null), 'flower');
        return;
      case 'snapshot':
        return this.snapshot(context, entry);
      case 'create':
        return this.createNote(input, context, entry);
      case 'open': {
        const id = z.string().min(1).max(200).parse(input);
        await openPetalNote(context.library.id, id, this.windows, this.notes!, this.board!, this.drawer);
        this.changed();
        return;
      }
      case 'expand':
        if (entry?.instanceId)
          await expandPetalNote(entry, z.boolean().parse(input), {
            windows: this.windows,
            notes: this.notes!,
            drawer: this.drawer,
            flush: () => this.flushEntry(entry, true),
            remove: () => this.removeNoteWindow(context.library.id, entry.instanceId!),
            changed: () => this.changed(),
          });
        return;
      case 'always-on-top':
        if (!entry?.instanceId) throw petalError('sourceUnavailable');
        this.windows.setAlwaysOnTop(entry, z.boolean().parse(input));
        return;
      case 'undo-collection':
        if (entry?.instanceId) throw petalError('hubOnly');
        await this.windows.undoCollection(context.library.id, z.string().uuid().parse(input));
        this.changed();
        return;
      case 'resize':
        if (!entry?.instanceId) throw petalError('sourceUnavailable');
        this.windows.resizeNote(entry, petalNoteSizeSchema.parse(input));
        return;
      case 'hide':
        if (entry) await this.windows.hide(entry);
        return;
      case 'remove':
        return removePetalPlacement(
          {
            windows: this.windows,
            board: this.board!,
            flushNote: (current) => this.flushEntry(current),
            removeNote: (id) => this.removeNoteWindow(context.library.id, id),
            changed: () => this.changed(),
          },
          context,
          entry,
        );
      case 'main':
        return this.openSourceWindow(context, entry);
      default:
        throw new Error('Unknown desktop petal command');
    }
  }
  private executeNoteAlbum(command: string, input: unknown, context: ActiveLibraryContext, entry?: PetalWindow) {
    if (command === 'note-albums')
      return context.database
        .listAlbums(this.language.locale)
        .filter((album) => !album.archivedAt)
        .map(({ id, title }) => ({ id, title }));
    if (command === 'note-album') {
      const request = z
        .object({ id: z.string().min(1).max(200), albumId: z.string().min(1).max(200).nullable() })
        .strict()
        .parse(input);
      if (entry?.instanceId && entry.instanceId !== request.id) throw petalError('sourceUnavailable');
      const note = this.notes!.setAlbum(request.id, request.albumId);
      if (note.persisted) this.publishSource(context, note.id);
      this.changed();
      return note;
    }
  }
  private async executeContentLibrary(input: unknown, context: ActiveLibraryContext) {
    const request = contentLibraryCommandSchema.parse(input);
    if (request.kind === 'agent-link') throw new Error('AIY_AGENT_CONTENT_UNSUPPORTED_HOST');
    if (request.kind === 'reference-copy') return copyLibraryReference(context.database, request);
    if (request.kind === 'link-preview') return linkPreviews.get(request.url);
    if (request.kind === 'link-open') return openLinkCard(request.url);
    if (request.kind.startsWith('note-')) throw petalError('sourceUnavailable');
    if (request.kind === 'reveal') {
      const error = await shell.openPath(await context.database.ensureContentDirectory(request.source));
      if (error) throw new Error(error);
      return;
    }
    return context.database.executeContentLibrary(request);
  }
  private executeBoard(command: string, input: unknown, context: ActiveLibraryContext, entry?: PetalWindow) {
    if (command === 'board') {
      const request = petalBoardCommandSchema.parse(input);
      if (
        entry?.instanceId &&
        !(
          ['assign-layer', 'unpin', 'pin-appearance'].includes(request.kind) &&
          'id' in request &&
          request.id === entry.instanceId
        )
      )
        throw petalError('hubOnly');
      return this.board!.run(request);
    }
    if (command === 'pin-search') {
      if (entry?.instanceId) throw petalError('hubOnly');
      return context.database.petalBoard.search(pinSearchSchema.parse(input));
    }
  }
  private async executeReferences(input: unknown, context: ActiveLibraryContext, entry?: PetalWindow) {
    const request = petalReferenceCommandSchema.parse(input);
    if (isContentPinId(request.id) || (entry && entry.instanceId !== request.id)) throw petalError('sourceUnavailable');
    const result = await changePetalReferences(
      context.database,
      this.notes!,
      request,
      this.language.messages.board.IMAGE,
      entry?.window,
    );
    if (!Array.isArray(result) && result.persisted) {
      this.board!.registerNote(result.id, true);
      this.publishSource(context, result.id);
      this.changed();
    }
    return result;
  }
  private async executeContentAction(input: unknown, context: ActiveLibraryContext, entry?: PetalWindow) {
    const request = codexContentCommandSchema.parse(input);
    if (entry?.instanceId && 'stashId' in request) {
      if (isContentPinId(entry.instanceId) || this.notes!.get(entry.instanceId).stashId !== request.stashId)
        throw petalError('sourceUnavailable');
    }
    const service = context.codexContent;
    if (['models', 'select-execution', 'open-task', 'stop-and-open-task'].includes(request.kind))
      return this.executeContentExecution(request, context);
    if (['settings', 'select-album', 'configure-quota', 'quota'].includes(request.kind))
      return this.executeContentSettings(request, context, entry);
    const navigate = (kind: 'CODEX' | 'CODEX_SETTINGS' | 'ALBUM' | 'MATERIAL' | 'SOURCE', id: string | null) => {
      const main = this.options.getMainWindow();
      if (main?.isMinimized()) main.restore();
      main?.show();
      main?.focus();
      main?.webContents.send('desktop-petals:navigate', { libraryId: context.library.id, kind, id });
    };
    switch (request.kind) {
      case 'open-settings':
        return navigate('CODEX_SETTINGS', CODEX_EXTENSION_ID);
      case 'open-source':
        context.database.getInspirationStash(request.stashId);
        return navigate('SOURCE', request.stashId);
      case 'open-result': {
        const task = service.repository.get(request.taskId)?.task;
        if (
          task?.stashId !== request.stashId ||
          !task.results.some((result) => result.materialId === request.materialId)
        )
          throw petalError('sourceUnavailable');
        return navigate('MATERIAL', request.materialId);
      }
      case 'state':
        return service.state(request.stashId);
      case 'projects':
        return service.projects(request.fresh);
      case 'select-project':
        return service.selectProject(request.stashId, request.project);
      case 'start':
        return service.start(request, this.language.messages.actions.gallery, this.language.locale);
      case 'stop':
        return service.stop(request.stashId, request.taskId);
      case 'collect':
        return service.collect(request.stashId, request.taskId);
      case 'open-task-album': {
        const task = service.repository.get(request.taskId)?.task;
        if (!task || task.stashId !== request.stashId) throw petalError('sourceUnavailable');
        return navigate('ALBUM', task.albumId);
      }
      case 'open-plugin':
      case 'open-album': {
        return navigate(
          request.kind === 'open-plugin' ? 'CODEX' : 'ALBUM',
          request.kind === 'open-plugin'
            ? CODEX_EXTENSION_ID
            : service.repository.ensureAlbum(this.language.messages.actions.gallery, this.language.locale),
        );
      }
    }
  }
  private executeContentExecution(request: CodexContentCommand, context: ActiveLibraryContext) {
    if (request.kind === 'models') return context.codexContent.models();
    if (request.kind === 'select-execution')
      return context.codexContent.selectExecution(request.stashId, request.execution);
    if (request.kind === 'open-task' || request.kind === 'stop-and-open-task')
      return context.codexContent.openTask(request.stashId, request.taskId, request.kind === 'stop-and-open-task');
  }
  private contentApplications(context: ActiveLibraryContext, entry?: PetalWindow) {
    return new ContentApplicationRegistry(context.extensions).register({
      id: CODEX_CONTENT_APPLICATION_ID,
      extensionId: CODEX_EXTENSION_ID,
      name: this.language.messages.codex.title,
      configurationCommands: ['open-plugin', 'settings', 'select-album', 'configure-quota', 'quota'],
      requiredPermissions: [
        EXTENSION_PERMISSION.integrationConnectCodexAppServer,
        EXTENSION_PERMISSION.codexManageExtensionThreads,
        EXTENSION_PERMISSION.libraryReadSelectedReferences,
        EXTENSION_PERMISSION.libraryCreateCreations,
        EXTENSION_PERMISSION.filesystemReadCodexSessionMetadata,
      ],
      execute: (command) => this.executeContentAction(command, context, entry),
      openSettings: () => this.executeContentAction({ kind: 'open-settings' }, context, entry),
    });
  }
  private executePresentation(command: string, input: unknown, entry?: PetalWindow) {
    if (!entry) throw petalError('hubOnly');
    if (command === 'menu-open') {
      const request = z.object({ open: z.boolean(), point: petalPointSchema.optional() }).strict().parse(input);
      if (request.open && (entry.expanded || this.dragOrigins.has(entry.window.webContents.id)))
        throw petalError('invalidSettings');
      if (request.open && this.windows.presentation.dock(entry)?.collapsed)
        this.windows.presentation.reveal(entry, true);
      this.windows.presentation.preview(entry, request.open, 'menu');
      const cursor = request.point ?? screen.getCursorScreenPoint();
      const bounds = entry.window.getBounds();
      return {
        x: Math.round(Math.max(8, Math.min(bounds.width - 8, cursor.x - bounds.x))),
        y: Math.round(Math.max(8, Math.min(bounds.height - 8, cursor.y - bounds.y))),
      };
    }
    if (entry.instanceId) throw petalError('hubOnly');
    if (command === 'pluck-watch') {
      const request = z.object({ token: z.string().uuid(), active: z.boolean() }).strict().parse(input);
      return this.windows.pluck.watch(entry, request.token, request.active);
    }
    if (command === 'pluck-position') {
      const request = z.object({ point: petalPointSchema, pointer: petalPointSchema.optional() }).strict().parse(input);
      return this.windows.presentation.pluckPosition(request.point, request.pointer);
    }
    const active = z.boolean().parse(input);
    if (command === 'pluck-preview') this.windows.presentation.preview(entry, active);
    else if (!this.dragOrigins.has(entry.window.webContents.id)) this.windows.presentation.reveal(entry, active);
    return;
  }
  private async executeContentSettings(
    request: CodexContentCommand,
    context: ActiveLibraryContext,
    entry?: PetalWindow,
  ) {
    if (entry) throw petalError('hubOnly');
    switch (request.kind) {
      case 'settings':
        return context.codexContent.settings(this.language.locale);
      case 'select-album':
        return context.codexContent.selectAlbum(request.albumId, this.language.locale);
      case 'quota':
        return context.codexContent.quota.read(this.hub.layouts.hubSettings.codexLimitId);
      case 'configure-quota':
        await this.hub.configureQuota(request.limitId);
        this.changed();
        return;
    }
  }
  private openSourceWindow(context: ActiveLibraryContext, entry?: PetalWindow, targetId = entry?.instanceId) {
    return openPetalSourceWindow(context, targetId, {
      board: this.board!,
      notes: this.notes!,
      main: this.options.getMainWindow(),
      publishSource: (id) => this.publishSource(context, id, true),
    });
  }
  private executeNote(command: string, input: unknown, context: ActiveLibraryContext, entry?: PetalWindow) {
    if (command === 'content-image-accepted')
      return contentImageImports(context.database).accepted(contentImageImportIdSchema.parse(input));
    if (command === 'content-image-stage')
      return contentImageImports(context.database).stage(contentImageStageSchema.parse(input));
    if (command === 'content-image-resolve')
      return contentImageImports(context.database).resolve(contentImageImportIdSchema.parse(input));
    const requireNote = (id: string) => {
      if (entry?.instanceId && entry.instanceId !== id) throw new Error('This window cannot edit another note');
    };
    if (command === 'checkpoint') {
      const request = desktopNoteDraftSchema.parse(input);
      requireNote(request.id);
      return this.notes!.checkpoint(request);
    }
    if (command === 'appearance') {
      const request = desktopNoteAppearanceSchema.parse(input);
      requireNote(request.id);
      if (isContentPinId(request.id)) throw petalError('invalidSettings');
      const note = this.notes!.appearance(request.id, request);
      this.changed();
      return note;
    }
    const request = desktopNoteSaveSchema.parse(input);
    requireNote(request.id);
    const note = this.notes!.save(request);
    if (entry) observePetalFlush(entry, { status: note.persisted ? 'saved' : 'unchanged' });
    if (note.persisted) this.board!.registerNote(note.id, true);
    if (note.persisted) this.publishSource(context, note.id);
    this.changed();
    return note;
  }
  private executeHub(command: string, input: unknown, context: ActiveLibraryContext, entry?: PetalWindow) {
    return executePetalHubCommand(
      {
        windows: this.windows,
        board: this.board!,
        drawer: this.drawer,
        hub: this.hub,
        changed: () => this.changed(),
        drain: () => this.drain(),
        resume: () => this.resume(),
        activate: (next) => this.activate(next),
        notes: this.notes!,
        flushNote: (current) => this.flushEntry(current, true),
        checkpointNote: (current) => this.flushEntry(current),
        openSource: async (id) => this.openSourceWindow(context, undefined, id),
        removeNote: (id) => this.removeNoteWindow(context.library.id, id),
        suspend: () => {
          this.suspended = true;
        },
        restoration: this.restorePromise,
      },
      command,
      input,
      context,
      entry,
    );
  }
  private snapshot(context: ActiveLibraryContext, entry?: PetalWindow): DesktopPetalSnapshot {
    return desktopPetalSnapshot(context, entry, {
      notes: this.notes!,
      windows: this.windows,
      drawer: this.drawer,
      board: this.board!,
      suspended: this.suspended,
      contentApplications: this.contentApplications(context, entry).list(),
    });
  }
  private publishSource(context: ActiveLibraryContext, id: string, open = false) {
    this.options.getMainWindow()?.webContents.send('desktop-petals:source-changed', {
      libraryId: context.library.id,
      ...context.database.getDesktopNoteSource(id),
      open,
    });
  }
  changed() {
    this.tray.update();
    this.drawer?.invalidate();
    for (const { window } of this.windows.entries.values())
      if (!window.isDestroyed() && window.isVisible()) window.webContents.send('desktop-petals:changed');
  }
  private flushEntry(entry: PetalWindow, save = false): Promise<boolean> {
    return flushPetalInput(entry, this.pendingFlushes, this.notes, save);
  }
  async drain() {
    this.suspended = true;
    this.changed();
    try {
      await this.drawer.settle();
      // Finish the one in-flight renderer before requesting editor saves;
      // suspension prevents the remaining saved windows from being opened.
      await this.restorePromise?.catch(() => undefined);
      const results = await Promise.all([...this.windows.entries.values()].map((entry) => this.flushEntry(entry)));
      await this.windows.flush();
      if (results.some((saved) => !saved)) {
        this.resume();
        return false;
      }
      for (const entry of [...this.windows.entries.values()]) {
        if (entry.instanceId && this.notes?.isPending(entry.instanceId))
          this.removeNoteWindow(entry.libraryId, entry.instanceId);
      }
      await this.windows.flush();
    } catch (error) {
      console.error('[desktop-petals] could not finish saving', error);
      this.resume();
      return false;
    }
    this.windows.allowClose = true;
    return true;
  }
  resume() {
    this.suspended = false;
    this.windows.allowClose = false;
    for (const entry of this.windows.entries.values()) entry.editEpoch++;
    this.changed();
    void this.windows.resumeRestores().catch((error) => console.error('[desktop-petals] resume failed', error));
  }
  async activate(context: ActiveLibraryContext, restoreAfter?: Promise<void>) {
    await this.ready;
    await this.windows.layouts.replayCalendarEvents();
    this.unsubscribeSources?.();
    this.unsubscribePins?.();
    this.unsubscribeContent?.();
    const contentChanged = (change?: { stashId: string }) => {
      if (!change) this.changed();
      for (const { window } of this.windows.entries.values())
        if (!window.isDestroyed() && window.isVisible())
          window.webContents.send('desktop-petals:content-changed', change);
      this.options.getMainWindow()?.webContents.send('desktop-petals:content-changed', change);
    };
    context.codexContent.on('changed', contentChanged);
    this.unsubscribeContent = () => context.codexContent.off('changed', contentChanged);
    this.windows.destroyAll();
    this.drawer.view.cancel();
    this.notes = new PetalNoteService(context.database);
    this.board = new PetalBoardService(
      context,
      this.windows,
      async (id) => {
        const entry = this.windows.find(context.library.id, id);
        if (!entry) return true;
        try {
          return await this.flushEntry(entry);
        } finally {
          if (!entry.window.isDestroyed()) {
            entry.editEpoch++;
            entry.window.webContents.send('desktop-petals:changed');
          }
        }
      },
      () => this.changed(),
      (id) => {
        try {
          this.notes!.get(id);
          return true;
        } catch {
          return false;
        }
      },
    );
    const current = () => this.options.getContext() === context;
    this.unsubscribePins = observePetalPins(context, current, () => this.board?.reconcile());
    this.unsubscribeSources = observePetalSources(
      context,
      current,
      () =>
        [...this.windows.entries.values()].flatMap((entry) =>
          entry.instanceId && !isContentPinId(entry.instanceId) && !this.notes!.isPending(entry.instanceId)
            ? [entry.instanceId]
            : [],
        ),
      (id) => this.removeNoteWindow(context.library.id, id),
      (removed) => {
        this.changed();
        if (removed)
          void this.windows.flush().catch((error) => console.error('[desktop-petals] layout save failed', error));
      },
    );
    for (const id of context.database.reconcileDesktopNoteSources()) this.removeNoteWindow(context.library.id, id);
    context.database.petalBoard.reconcile();
    const board = this.board.snapshot();
    const ids = [...context.database.listDesktopNoteIds(), ...board.pins.map((pin) => pin.id)];
    this.windows.layouts.migrateArticlePins(context.library.id, ids);
    this.windows.layouts.prune(context.library.id, ids);
    this.dragOrigins.clear();
    this.windows.allowClose = false;
    this.suspended = false;
    const restore = async () => {
      const canRestore = () => current() && context.state === 'ACTIVE' && !this.suspended;
      if (!canRestore()) return;
      await this.drawer.activate();
      if (this.windows.layouts.get(context.library.id, 'hub')?.visible)
        await this.windows.restore(context.library.id, null);
      for (const id of ids) {
        if (!canRestore()) return;
        if (
          this.windows.layouts.get(context.library.id, id)?.visible &&
          this.windows.layouts.get(context.library.id, id)?.home !== 'drawer' &&
          !board.hiddenLayerIds.includes(board.memberships[id] ?? 'default')
        )
          await this.windows.restore(context.library.id, id);
      }
    };
    const startRestoring = () => {
      const pending = restore();
      this.restorePromise = pending;
      this.changed();
      return pending.finally(() => {
        if (this.restorePromise === pending) {
          this.restorePromise = null;
          this.changed();
        }
      });
    };
    if (restoreAfter) {
      void restoreAfter.then(startRestoring).catch((error) => console.error('[desktop-petals] restore failed', error));
    } else await startRestoring();
  }
  private removeNoteWindow(libraryId: string, instanceId: string) {
    const entry = this.windows.find(libraryId, instanceId);
    if (entry) {
      for (const pending of [...this.pendingFlushes.values()])
        if (pending.senderId === entry.window.webContents.id) pending.finish(true, { status: 'unchanged' });
      this.dragOrigins.delete(entry.window.webContents.id);
    }
    this.notes?.discard(instanceId);
    this.board?.forgetNote(instanceId);
    this.windows.remove(libraryId, instanceId);
  }
}
