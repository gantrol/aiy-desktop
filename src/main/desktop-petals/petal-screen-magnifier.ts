import { app, powerMonitor, screen } from 'electron';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { PetalWindow, PetalWindows } from '@/main/desktop-petals/petal-windows';
import { startWindowsMagnifier } from '@/main/screen-magnifier/windows-magnifier';
import {
  screenMagnifierActionSchema,
  screenMagnifierSettingsSchema,
  type ScreenMagnifierState,
} from '@/shared/contracts/screen-magnifier';
import { SCREEN_MAGNIFIER_EXTENSION_ID } from '@/shared/extension-ids';
import { petalError } from '@/shared/petal-errors';

interface Options {
  windows: PetalWindows;
  context(): ActiveLibraryContext | null;
  suspended(): boolean;
  allowPresentation: boolean;
  changed(): void;
}
interface Session {
  owner: PetalWindow;
  stop(): void;
  detach(): void;
}

/** The flower owns the session, including native process lifetime and permission revocation. */
export class PetalScreenMagnifier {
  private status: ScreenMagnifierState['status'] = 'off';
  private session: Session | null = null;
  private unsubscribe?: () => void;
  private readonly stopForSystem = () => this.stop();

  constructor(private readonly options: Options) {
    options.windows.presentation.keepExpanded = (entry) => this.session?.owner === entry;
    options.windows.presentation.onConceal = (entry) => {
      if (this.session?.owner === entry) this.stop();
    };
    powerMonitor.on('lock-screen', this.stopForSystem);
    powerMonitor.on('suspend', this.stopForSystem);
    screen.on('display-removed', this.stopForSystem);
    app.on('before-quit', this.stopForSystem);
    app.once('will-quit', () => {
      this.stop();
      this.unsubscribe?.();
      powerMonitor.off('lock-screen', this.stopForSystem);
      powerMonitor.off('suspend', this.stopForSystem);
      screen.off('display-removed', this.stopForSystem);
      app.off('before-quit', this.stopForSystem);
    });
  }

  activate(context: ActiveLibraryContext) {
    this.stop();
    this.unsubscribe?.();
    this.unsubscribe = context.extensions.onChanged(() => {
      if (!context.extensions.isActivated(SCREEN_MAGNIFIER_EXTENSION_ID)) this.stop();
      this.options.changed();
    });
  }

  state(): ScreenMagnifierState {
    const context = this.options.context();
    const availability =
      process.platform !== 'win32' || process.arch !== 'x64'
        ? 'unsupported'
        : context?.extensions.isActivated(SCREEN_MAGNIFIER_EXTENSION_ID)
          ? 'ready'
          : 'disabled';
    return { availability, status: this.status };
  }

  private canRun(owner: PetalWindow) {
    const context = this.options.context();
    return (
      this.options.allowPresentation &&
      !this.options.suspended() &&
      context?.state === 'ACTIVE' &&
      context.library.id === owner.libraryId &&
      !owner.instanceId &&
      !owner.drawer &&
      (owner.hubView === 'flower' || owner.hubView === 'settings') &&
      !owner.window.isDestroyed() &&
      owner.window.isVisible() &&
      !owner.window.isMinimized() &&
      !this.options.windows.presentation.dock(owner)?.collapsed
    );
  }

  execute(raw: unknown, owner?: PetalWindow) {
    const action = screenMagnifierActionSchema.parse(raw);
    if (!owner || owner.instanceId || owner.drawer) throw petalError('hubOnly');
    if (action === 'stop') {
      if (!this.session || this.session.owner === owner) this.stop();
      return;
    }
    const state = this.state();
    if (state.availability === 'unsupported') throw petalError('magnifierUnsupported');
    if (state.availability !== 'ready') throw petalError('magnifierDisabled');
    if (!this.canRun(owner)) throw petalError('magnifierOwnerHidden');
    if (this.session?.owner === owner) return;
    this.stop();
    const stop = () => this.stop();
    const session: Session = {
      owner,
      stop: () => undefined,
      detach: () => {
        owner.window.off('hide', stop);
        owner.window.off('closed', stop);
        owner.window.off('minimize', stop);
        owner.window.webContents.off('render-process-gone', stop);
        owner.window.webContents.off('did-start-loading', stop);
      },
    };
    owner.window.on('hide', stop);
    owner.window.on('closed', stop);
    owner.window.on('minimize', stop);
    owner.window.webContents.on('render-process-gone', stop);
    owner.window.webContents.on('did-start-loading', stop);
    this.session = session;
    this.status = 'starting';
    this.options.changed();
    try {
      session.stop = startWindowsMagnifier(
        owner.window,
        () => screenMagnifierSettingsSchema.parse(this.options.windows.layouts.hubSettings.magnifier ?? {}),
        () => this.session === session && this.canRun(owner) && this.state().availability === 'ready',
        () => {
          if (this.session !== session) return;
          if (!this.canRun(owner) || this.state().availability !== 'ready') {
            this.stop();
            return;
          }
          this.status = 'on';
          this.options.changed();
        },
        (failed) => {
          if (this.session !== session) return;
          this.session = null;
          session.detach();
          this.status = failed ? 'failed' : 'off';
          this.options.changed();
        },
      );
    } catch {
      this.stop();
      this.status = 'failed';
      this.options.changed();
      throw petalError('magnifierFailed');
    }
  }

  stop() {
    const session = this.session;
    if (!session && this.status === 'off') return;
    this.session = null;
    session?.detach();
    session?.stop();
    this.status = 'off';
    this.options.changed();
  }
}
