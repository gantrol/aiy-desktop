import { app, clipboard, dialog, globalShortcut, powerMonitor, screen, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import { createTrustedIpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import { contentImageImports } from '@/main/creations/content-image-imports';
import { ClipboardStore, type ClipboardPayload } from '@/main/clipboard-capture/store';
import { ClipboardRecordingPause } from '@/main/clipboard-capture/recording-pause';
import { CaptureHistory } from '@/main/clipboard-capture/capture-history';
import { captureRecording } from '@/main/clipboard-capture/capture-recording';
import { WindowsClipboardClient } from '@/main/clipboard-capture/windows-client';
import { captureLanguage } from '@/main/clipboard-capture/capture-language';
import type { CaptureAction, CaptureActionResult, CaptureBounds } from '@/main/clipboard-capture/capture-session';
import {
  CLIPBOARD_CAPTURE_ID,
  CLIPBOARD_HISTORY_ID,
  clipboardCommandSchema,
  type ClipboardCommand,
  type ClipboardResult,
  type ClipboardStatus,
  type ClipboardSettings,
  type ClipboardOperation,
} from '@/shared/contracts/clipboard-capture';
import { EXTENSION_PERMISSION as permission } from '@/shared/extension-permissions';
import { normalizeCaptureShortcut } from '@/shared/capture-shortcuts';

interface Options {
  main(): BrowserWindow | null;
  context(): ActiveLibraryContext | null;
  locale(): string;
  openTemporary(
    id: string,
    text: string,
    bytes: Buffer | null,
    promote: boolean,
    mayPromote?: () => boolean,
    edit?: boolean,
    origin?: { kind: 'capture' | 'clipboard' | 'stitch'; bounds?: CaptureBounds },
    returnToCapture?: AbortSignal,
  ): Promise<void | Buffer | null>;
  allowPresentation: boolean;
}
const knownErrors = new Set([
  'storage',
  'corrupt',
  'missing',
  'tooLarge',
  'full',
  'cancelled',
  'native',
  'permission',
  'unsupported',
  'busy',
  'shortcut',
  'spaceChanged',
  'cleanup',
  'captureNotSaved',
  'captureHistoryFailed',
  'pasteTarget',
  'textTooLarge',
]);

export class ClipboardCaptureService {
  private readonly store = new ClipboardStore(path.join(app.getPath('userData'), 'clipboard-history'));
  private readonly history = new CaptureHistory(path.join(app.getPath('userData'), 'capture-history'), {
    status: () => this.status(),
    enabled: () => Boolean(this.options.context()?.extensions.isActivated(CLIPBOARD_CAPTURE_ID)),
    copy: (payload) => this.copy(payload),
    open: async (id, bytes, edit) => {
      await this.options.openTemporary(id, '', bytes, false, undefined, edit, { kind: 'capture' });
    },
    changed: () => this.changed(),
  });
  private helper: WindowsClipboardClient | null = null;
  private helperReady: Promise<void> | null = null;
  private helperConfigured = false;
  private recordingRevision = 0;
  private readonly recordingPause = new ClipboardRecordingPause(() => this.refreshRecording());
  private unsubscribe: (() => void) | null = null;
  private suspended = false;
  private locked = powerMonitor.getSystemIdleState(1) === 'locked';
  private sleeping = false;
  private epoch = 0;
  private fingerprint = '';
  private registeredShortcuts: string[] = [];
  private pasteQueue: string[] = [];
  private error: string | null = null;
  private busy = false;
  private searchGeneration = 0;
  private readGeneration = 0;
  private disposed = false;
  private capturing = false;
  private captureGeneration = 0;
  private captureDelay: AbortController | null = null;
  private captureAction: Promise<CaptureActionResult> | null = null;
  private captureAbort: AbortController | null = null;
  private readonly cancelCapture = () => {
    this.captureGeneration++;
    this.captureDelay?.abort();
    this.captureAbort?.abort();
    this.helper?.cancelCapture();
  };
  private readonly suspend = () => {
    this.suspended = true;
    this.refresh();
  };
  private readonly resume = () => {
    this.suspended = this.locked || this.sleeping;
    this.recordingPause.checkExpiry();
    this.refresh();
  };
  private readonly lock = () => {
    this.locked = true;
    this.suspend();
  };
  private readonly unlock = () => {
    this.locked = false;
    this.resume();
  };
  private readonly sleep = () => {
    this.sleeping = true;
    this.suspend();
  };
  private readonly wake = () => {
    this.sleeping = false;
    this.resume();
  };
  constructor(private readonly options: Options) {
    createTrustedIpcHandlerRegistrar(options.main).handle(
      'clipboard-capture:execute',
      async (_event, raw: unknown): Promise<ClipboardResult> => {
        try {
          return await this.execute(clipboardCommandSchema.parse(raw));
        } catch (error) {
          return { kind: 'error', code: this.code(error) };
        }
      },
    );
    this.suspended = this.locked;
    powerMonitor.on('lock-screen', this.lock);
    powerMonitor.on('suspend', this.sleep);
    powerMonitor.on('unlock-screen', this.unlock);
    powerMonitor.on('resume', this.wake);
    screen.on('display-removed', this.cancelCapture);
    screen.on('display-metrics-changed', this.cancelCapture);
    app.on('before-quit', this.suspend);
    app.once('will-quit', () => this.dispose());
    void this.store.ready
      .then(() => this.refresh())
      .catch(() => {
        this.error = 'storage';
        this.changed();
      });
  }
  private code(error: unknown) {
    return error instanceof Error && knownErrors.has(error.message) ? error.message : 'storage';
  }
  private changed() {
    const window = this.options.main();
    if (window && !window.isDestroyed()) window.webContents.send('clipboard-capture:changed');
  }
  activate(context: ActiveLibraryContext) {
    this.unsubscribe?.();
    this.unsubscribe = context.extensions.onChanged(() => this.refresh());
    this.fingerprint = '';
    this.refresh();
  }
  private allowed(name: string) {
    const context = this.options.context();
    const extensionId = name === permission.screenCaptureRegion ? CLIPBOARD_CAPTURE_ID : CLIPBOARD_HISTORY_ID;
    return Boolean(
      context?.state === 'ACTIVE' &&
      context.extensions.isActivated(extensionId) &&
      context.extensions.isPermissionGranted(extensionId, name),
    );
  }
  private status(): ClipboardStatus {
    const context = this.options.context();
    return {
      settings: { ...this.store.settings, recording: !this.recordingPause.state },
      supported: process.platform === 'win32',
      enabled: Boolean(context?.state === 'ACTIVE' && context.extensions.isEnabled(CLIPBOARD_HISTORY_ID)),
      recording: Boolean(
        this.helper &&
        !this.helper.closed &&
        this.helperConfigured &&
        !this.suspended &&
        !this.recordingPause.state &&
        this.allowed(permission.clipboardReadHistory),
      ),
      starting: Boolean(
        this.helper &&
        !this.helper.closed &&
        !this.helperConfigured &&
        !this.suspended &&
        !this.recordingPause.state &&
        this.allowed(permission.clipboardReadHistory),
      ),
      pause: this.recordingPause.state,
      canRecord: this.allowed(permission.clipboardReadHistory),
      canPreserveFiles: this.allowed(permission.clipboardReadImageFiles),
      canCapture: this.allowed(permission.screenCaptureRegion),
      canImport: this.allowed(permission.libraryCreateCreations),
      count: this.store.items.length,
      usedBytes: this.store.usedBytes,
      limitBytes: this.store.limitBytes,
      limitCount: this.store.limitCount,
      queuedCount: this.pasteQueue.length,
      error: this.error,
    };
  }
  private refresh() {
    if (this.disposed) return;
    const next = JSON.stringify([
      this.options.context()?.epoch,
      this.store.settings,
      this.suspended,
      this.status().enabled,
      this.options.context()?.extensions.isActivated(CLIPBOARD_CAPTURE_ID),
      this.allowed(permission.clipboardReadHistory),
      this.allowed(permission.clipboardReadImageFiles),
      this.allowed(permission.screenCaptureRegion),
    ]);
    if (next === this.fingerprint) {
      this.changed();
      return;
    }
    this.fingerprint = next;
    this.epoch++;
    this.helper?.dispose();
    this.helper = null;
    this.helperReady = null;
    this.helperConfigured = false;
    this.registeredShortcuts.forEach((shortcut) => globalShortcut.unregister(shortcut));
    this.registeredShortcuts = [];
    this.pasteQueue = [];
    if (!this.suspended && process.platform === 'win32' && this.options.allowPresentation) {
      const epoch = this.epoch;
      if (this.status().enabled)
        void this.native().catch((error) => {
          if (epoch !== this.epoch || this.disposed) return;
          this.error = this.code(error);
          this.changed();
        });
      const shortcut = this.store.settings.captureShortcut;
      if (shortcut && this.allowed(permission.screenCaptureRegion)) {
        if (
          globalShortcut.register(shortcut, () => {
            void this.execute({ kind: 'capture' }, true).catch((error) => {
              this.error = this.code(error);
              this.changed();
            });
          })
        )
          this.registeredShortcuts.push(shortcut);
        else this.error = 'shortcut';
      }
      if (this.options.context()?.extensions.isActivated(CLIPBOARD_CAPTURE_ID))
        this.registerShortcut(this.store.settings.pinShortcut, () => this.pinClipboard());
      if (this.status().enabled) {
        this.registerShortcut(this.store.settings.historyShortcut, () => this.openHistory());
        this.registerShortcut(this.store.settings.pasteNextShortcut, async () => {
          if (this.pasteQueue.length) await this.execute({ kind: 'pasteNext' });
        });
      }
    }
    this.changed();
  }
  private registerShortcut(shortcut: string, action: () => Promise<unknown>) {
    if (!shortcut) return;
    if (
      globalShortcut.register(shortcut, () => {
        void action().catch((error) => {
          this.error = this.code(error);
          this.changed();
        });
      })
    )
      this.registeredShortcuts.push(shortcut);
    else this.error = 'shortcut';
  }
  async openHistory() {
    if (!this.status().enabled || this.suspended) throw new Error('permission');
    // History management and recording controls must remain reachable if the helper fails.
    try {
      await (await this.native()).request({ kind: 'remember-target' });
    } catch (error) {
      this.error = this.code(error);
      this.changed();
    }
    if (!this.canOpenHistory) throw new Error('cancelled');
    const window = this.options.main();
    if (!window || window.isDestroyed()) throw new Error('cancelled');
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    window.webContents.send('clipboard-capture:open-history');
  }
  async startCapture() {
    try {
      await this.execute({ kind: 'capture' }, true);
    } catch (error) {
      this.error = this.code(error);
      this.changed();
    }
  }
  get canCapture() {
    return process.platform === 'win32' && this.allowed(permission.screenCaptureRegion) && !this.suspended;
  }
  get canOpenHistory() {
    return this.status().enabled && !this.suspended && !this.disposed;
  }
  private async native() {
    if (process.platform !== 'win32') throw new Error('unsupported');
    if (this.suspended || this.disposed || !this.options.allowPresentation) throw new Error('cancelled');
    if (this.helper?.closed) this.helper = null;
    if (!this.helper) {
      const epoch = this.epoch;
      const helper = new WindowsClipboardClient(
        async (payload) => {
          const revision = this.recordingRevision;
          const accepted = () =>
            epoch === this.epoch &&
            revision === this.recordingRevision &&
            this.helperConfigured &&
            this.helper === helper &&
            !helper.closed &&
            !this.suspended &&
            !this.recordingPause.state &&
            this.allowed(permission.clipboardReadHistory);
          if (!accepted()) return;
          try {
            await this.store.run(() => this.store.add(payload, accepted));
            this.error = null;
          } catch (error) {
            this.error = this.code(error);
          }
          this.changed();
        },
        (code) => {
          if (epoch !== this.epoch || this.helper !== helper) return;
          this.error = code;
          if (helper.closed) {
            this.helper = null;
            this.helperConfigured = false;
          }
          this.changed();
        },
      );
      this.helper = helper;
      this.helperConfigured = false;
      // Share initialization so concurrent actions cannot overtake configuration.
      this.helperReady = this.configureNative(helper, epoch, this.recordingRevision);
    }
    const helper = this.helper;
    await this.helperReady;
    if (helper.closed || this.helper !== helper) throw new Error('cancelled');
    return helper;
  }
  private async configureNative(helper: WindowsClipboardClient, epoch: number, revision: number) {
    try {
      // Load source exclusions before enabling collection, including the first activation.
      await this.store.ready;
      await helper.ready;
      if (epoch !== this.epoch || this.helper !== helper) throw new Error('cancelled');
      await helper.request({
        kind: 'configure',
        recording: !this.recordingPause.state && this.allowed(permission.clipboardReadHistory),
        files: this.store.settings.preserveImageFiles && this.allowed(permission.clipboardReadImageFiles),
        excluded: this.store.settings.excludedApps,
      });
      if (epoch !== this.epoch || this.helper !== helper) throw new Error('cancelled');
      if (revision === this.recordingRevision) this.helperConfigured = true;
      if (this.error === 'native') this.error = null;
      this.changed();
    } catch (error) {
      const failure = epoch === this.epoch && helper.closed && !this.disposed ? new Error('native') : error;
      if (this.helper === helper) {
        helper.dispose();
        this.helper = null;
        this.helperConfigured = false;
        this.error = this.code(failure);
        this.changed();
      }
      throw failure;
    }
  }
  private refreshRecording() {
    const revision = ++this.recordingRevision;
    this.helperConfigured = false;
    const helper = this.helper;
    if (!helper || helper.closed) {
      this.fingerprint = '';
      this.refresh();
      return;
    }
    const epoch = this.epoch;
    // Change collection without interrupting an active capture or paste session.
    this.helperReady = this.helperReady!.then(() => this.configureNative(helper, epoch, revision));
    void this.helperReady.catch(() => undefined);
    this.changed();
  }
  private async copy(payload: ClipboardPayload, paste = false) {
    if (paste && !this.status().enabled) throw new Error('permission');
    await (
      await this.native()
    ).request({
      kind: paste ? 'paste' : 'copy',
      text: payload.text,
      html: payload.reference ? '' : payload.html,
      image: payload.image?.toString('base64') ?? null,
    });
  }
  private async pinClipboard() {
    if (this.busy) throw new Error('busy');
    const image = clipboard.readImage();
    if (image.isEmpty()) throw new Error('missing');
    const size = image.getSize();
    if (size.width * size.height > 20_000_000) throw new Error('tooLarge');
    const bytes = image.toPNG();
    const epoch = this.epoch;
    await this.options.openTemporary(randomUUID(), '', bytes, false, () => epoch === this.epoch && !this.suspended);
  }
  private async capture(keyboard: boolean, delaySeconds = 0, mode = 'region') {
    if (!this.allowed(permission.screenCaptureRegion)) throw new Error('permission');
    const epoch = this.epoch;
    const generation = ++this.captureGeneration;
    if (delaySeconds) {
      const abort = new AbortController();
      this.captureDelay = abort;
      try {
        await delay(delaySeconds * 1000, undefined, { signal: abort.signal });
      } catch {
        throw new Error('cancelled');
      } finally {
        if (this.captureDelay === abort) this.captureDelay = null;
      }
      if (generation !== this.captureGeneration || epoch !== this.epoch) throw new Error('cancelled');
    }
    const helper = await this.native();
    const accepted = () =>
      generation === this.captureGeneration &&
      epoch === this.epoch &&
      this.allowed(permission.screenCaptureRegion) &&
      !this.suspended &&
      !this.disposed;
    let adoption = { revision: -1, id: randomUUID() };
    this.capturing = true;
    this.captureAbort = new AbortController();
    try {
      if (!accepted()) throw new Error('cancelled');
      const labels = captureLanguage(this.options.context(), this.options.locale());
      await helper.capture(
        labels,
        this.options.locale(),
        keyboard,
        async (action, image, revision, bounds, partial, cursor) => {
          if (adoption.revision !== revision) adoption = { revision, id: randomUUID() };
          const work =
            action === 'record' && bounds
              ? captureRecording(
                  path.join(app.getPath('userData'), 'capture-recording'),
                  bounds,
                  cursor ?? true,
                  helper,
                  this.captureAbort!.signal,
                )
              : this.deliverCapture(action, image, adoption.id, accepted, bounds, partial);
          this.captureAction = work;
          try {
            return await work;
          } finally {
            if (this.captureAction === work) this.captureAction = null;
          }
        },
        mode,
      );
    } finally {
      this.captureAbort?.abort();
      this.captureAbort = null;
      await this.captureAction?.catch(() => undefined);
      this.capturing = false;
      this.changed();
    }
  }
  private async deliverCapture(
    action: CaptureAction,
    image: Buffer,
    id: string,
    accepted: () => boolean,
    bounds?: CaptureBounds,
    partial = false,
  ) {
    if (!accepted()) throw new Error('cancelled');
    let clipboardHistoryFailed = false;
    if (action === 'annotate') {
      const edited = await this.options.openTemporary(
        id,
        '',
        image,
        false,
        accepted,
        true,
        { kind: 'capture', bounds: bounds ? screen.screenToDipRect(null, bounds) : undefined },
        this.captureAbort!.signal,
      );
      return edited ? { image: edited } : false;
    }
    if (action === 'pin' || action === 'edit') {
      await this.options.openTemporary(id, '', image, false, accepted, action === 'edit', {
        kind: 'capture',
        bounds: bounds ? screen.screenToDipRect(null, bounds) : undefined,
      });
    } else if (action === 'export') {
      const result = await dialog.showSaveDialog({
        defaultPath: 'Capture.png',
        filters: [{ name: 'PNG', extensions: ['png'] }],
      });
      if (!accepted()) throw new Error('cancelled');
      if (result.canceled || !result.filePath) return false;
      await writeFile(result.filePath, image, { flush: true });
    } else {
      const payload = { text: '', html: '', image, source: 'AIY', reference: false };
      await this.copy(payload);
      // The helper suppresses its own clipboard writes. Record this explicit output once,
      // after copying, so a full history cannot prevent delivery to the clipboard.
      const recordingRevision = this.recordingRevision;
      const mayRecord = () =>
        accepted() &&
        recordingRevision === this.recordingRevision &&
        !this.recordingPause.state &&
        this.allowed(permission.clipboardReadHistory);
      if (mayRecord()) {
        try {
          await this.store.run(() => this.store.add(payload, mayRecord, true, id));
        } catch {
          if (mayRecord()) clipboardHistoryFailed = true;
        }
      }
    }
    try {
      await this.history.record(image, id, accepted, partial);
    } catch {
      throw new Error('captureHistoryFailed');
    }
    if (clipboardHistoryFailed) throw new Error('captureNotSaved');
    return true;
  }
  private async execute(command: ClipboardCommand, keyboard = false): Promise<ClipboardResult> {
    if (this.disposed) throw new Error('cancelled');
    if (command.kind === 'captureHistory') return this.history.execute(command.command);
    if (command.kind === 'shortcut') {
      await this.store.run(() => this.configure({ ...this.store.settings, [command.field]: command.value }));
      return { kind: 'status', value: this.status() };
    }
    return this.executeClipboard(command, keyboard);
  }
  private resumeRecording() {
    if (process.platform !== 'win32') throw new Error('unsupported');
    if (!this.allowed(permission.clipboardReadHistory)) throw new Error('permission');
    this.error = null;
    this.recordingPause.resume();
  }
  private async configure(settings: ClipboardSettings) {
    const values = [
      settings.captureShortcut,
      settings.pinShortcut,
      settings.historyShortcut,
      settings.pasteNextShortcut,
    ]
      .filter(Boolean)
      .map((value) => normalizeCaptureShortcut(value, process.platform));
    if (new Set(values).size !== values.length) throw new Error('shortcut');
    const active = [
      settings.captureShortcut !== this.store.settings.captureShortcut &&
        this.allowed(permission.screenCaptureRegion) &&
        settings.captureShortcut,
      settings.pinShortcut !== this.store.settings.pinShortcut &&
        this.options.context()?.extensions.isActivated(CLIPBOARD_CAPTURE_ID) &&
        settings.pinShortcut,
      settings.historyShortcut !== this.store.settings.historyShortcut &&
        this.status().enabled &&
        settings.historyShortcut,
      settings.pasteNextShortcut !== this.store.settings.pasteNextShortcut &&
        this.status().enabled &&
        settings.pasteNextShortcut,
    ].filter((value): value is string => Boolean(value));
    const reserved: string[] = [];
    try {
      for (const value of active) {
        if (
          this.registeredShortcuts.some(
            (existing) =>
              normalizeCaptureShortcut(existing, process.platform) ===
              normalizeCaptureShortcut(value, process.platform),
          )
        )
          continue;
        if (!globalShortcut.register(value, () => undefined)) throw new Error('shortcut');
        reserved.push(value);
      }
      // Ignore the legacy clipboard switch; capture history owns its separate setting.
      await this.store.configure({ ...settings, recording: true });
    } finally {
      reserved.forEach((value) => globalShortcut.unregister(value));
    }
    this.error = null;
    this.refresh();
  }
  private async executeClipboard(
    command: Exclude<ClipboardOperation, { kind: 'shortcut' }>,
    keyboard = false,
  ): Promise<ClipboardResult> {
    if (command.kind === 'pauseRecording') {
      if (this.disposed) throw new Error('cancelled');
      this.recordingPause.pause(command.duration);
      return { kind: 'status', value: this.status() };
    }
    if (command.kind !== 'capture') await this.store.ready;
    if (this.disposed) throw new Error('cancelled');
    if (command.kind === 'status') return { kind: 'status', value: this.status() };
    if (command.kind === 'cancelCapture') {
      this.cancelCapture();
      return { kind: 'done' };
    }
    if (command.kind === 'cancelPasteQueue') {
      this.pasteQueue = [];
      this.changed();
      return { kind: 'done' };
    }
    if (command.kind === 'list') {
      const generation = ++this.searchGeneration;
      await this.store.run(() => this.store.expire());
      return this.store.list(
        command.query,
        command.filter,
        command.offset,
        () => generation === this.searchGeneration && !this.disposed,
      );
    }
    if (command.kind === 'read') {
      const generation = ++this.readGeneration;
      const payload = await this.store.run(() => {
        if (generation !== this.readGeneration || this.disposed) throw new Error('cancelled');
        return this.store.read(command.id);
      });
      return {
        kind: 'detail',
        text: payload.text,
        image: payload.image ? `data:image/png;base64,${payload.image.toString('base64')}` : null,
      };
    }
    if (this.busy) {
      if (command.kind === 'capture' && this.capturing) {
        this.helper?.focusCapture();
        return { kind: 'done' };
      }
      throw new Error('busy');
    }
    this.busy = true;
    try {
      if (command.kind === 'resumeRecording') {
        this.resumeRecording();
        return { kind: 'status', value: this.status() };
      }
      if (command.kind === 'configure') {
        if (
          command.settings.preserveImageFiles &&
          !this.store.settings.preserveImageFiles &&
          !this.allowed(permission.clipboardReadImageFiles)
        )
          throw new Error('permission');
        await this.store.run(() => this.configure(command.settings));
        return { kind: 'status', value: this.status() };
      }
      if (command.kind === 'capture') await this.capture(keyboard, command.delaySeconds, command.mode);
      else if (command.kind === 'pasteQueue') {
        for (const id of command.ids) this.store.entry(id);
        this.pasteQueue = [...new Set(command.ids)];
      } else if (command.kind === 'pasteNext') {
        const id = this.pasteQueue[0];
        if (!id) throw new Error('missing');
        await this.store.run(async () => this.copy(await this.store.read(id), true));
        this.pasteQueue.shift();
      } else if (command.kind === 'clearClipboard') await (await this.native()).request({ kind: 'clear' });
      else if (command.kind === 'material') await this.material(command.id, command.spaceId);
      else
        await this.store.run(async () => {
          if (command.kind === 'pin') await this.store.pin(command.id, command.pinned);
          else if (command.kind === 'remove') await this.store.remove(command.id);
          else if (command.kind === 'removeMany') await this.store.removeMany(command.ids);
          else if (command.kind === 'clearHistory')
            await this.store.removeMany(
              this.store.items.filter((item) => command.includePinned || !item.pinned).map((item) => item.id),
            );
          else if (command.kind === 'saveText') await this.saveText(command.text);
          else if (command.kind === 'combine') {
            const parts: string[] = [];
            let length = 0;
            for (const id of [...new Set(command.ids)]) {
              if (this.store.entry(id).kind !== 'text') throw new Error('unsupported');
              const payload = await this.store.read(id);
              length += payload.text.length + command.separator.length;
              if (length > 262144) throw new Error('textTooLarge');
              parts.push(payload.text);
            }
            await this.saveText(parts.join(command.separator));
          } else {
            const payload = await this.store.read(command.id);
            if (command.kind === 'copy') await this.copy(payload);
            else if (command.kind === 'paste')
              await this.copy(command.plain ? { ...payload, html: '', image: null } : payload, true);
            else if (command.kind === 'copyPlain') await this.copy({ ...payload, html: '', image: null });
            else if (command.kind === 'editImage') {
              if (!payload.image) throw new Error('unsupported');
              await this.options.openTemporary(randomUUID(), '', payload.image, false, undefined, true);
            } else if (command.kind === 'open') {
              await this.options.openTemporary(randomUUID(), payload.text, payload.image, false);
            } else if (command.kind === 'export') {
              const owner = this.options.main();
              if (!owner) throw new Error('cancelled');
              const result = await dialog.showSaveDialog(owner, {
                defaultPath: payload.image ? 'Clipboard.png' : 'Clipboard.txt',
                filters: [{ name: payload.image ? 'PNG' : 'Text', extensions: [payload.image ? 'png' : 'txt'] }],
              });
              if (!result.canceled && result.filePath)
                await writeFile(result.filePath, payload.image ?? payload.text, { flush: true });
            }
          }
        });
      this.error = null;
      this.changed();
      return { kind: 'done' };
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  private async material(id: string, spaceId: string) {
    const context = this.options.context();
    if (!context || context.library.id !== spaceId) throw new Error('spaceChanged');
    if (!this.allowed(permission.libraryCreateCreations)) throw new Error('permission');
    const release = context.acquireOperation();
    const mayPromote = () => this.options.context() === context && this.allowed(permission.libraryCreateCreations);
    try {
      await this.store.run(async () => {
        const payload = await this.store.read(id);
        if (!mayPromote()) throw new Error('permission');
        if (!payload.image) {
          await this.options.openTemporary(randomUUID(), payload.text, null, true, mayPromote);
          return;
        }
        const imports = contentImageImports(context.database);
        await imports.stage({
          importId: id,
          source: 'UPLOAD',
          item: { name: 'Clipboard.png', mimeType: 'image/png', bytes: payload.image },
        });
        if (!mayPromote()) throw new Error('permission');
        await imports.resolve(id);
      });
    } finally {
      release();
    }
  }
  private async saveText(text: string) {
    if (!text.trim()) throw new Error('missing');
    await this.store.add({ text, html: '', image: null, source: 'AIY', reference: false }, () => !this.disposed, true);
  }
  async drain() {
    this.cancelCapture();
    await this.captureAction?.catch(() => undefined);
    await this.store.drain();
    await this.history.store.drain();
  }
  resumeRuntime() {
    this.resume();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.recordingPause.dispose();
    app.off('before-quit', this.suspend);
    this.epoch++;
    this.unsubscribe?.();
    this.helper?.dispose();
    this.helper = null;
    this.registeredShortcuts.forEach((shortcut) => globalShortcut.unregister(shortcut));
    powerMonitor.off('lock-screen', this.lock);
    powerMonitor.off('suspend', this.sleep);
    powerMonitor.off('unlock-screen', this.unlock);
    powerMonitor.off('resume', this.wake);
    screen.off('display-removed', this.cancelCapture);
    screen.off('display-metrics-changed', this.cancelCapture);
  }
}
