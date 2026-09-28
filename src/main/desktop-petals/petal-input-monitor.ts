import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { app, screen, type Point } from 'electron';
import { isPackagedApplication } from '@/main/app/runtime-mode';
import { parseWindowsPetalRelease, windowsPetalInputSource } from '@/main/desktop-petals/windows-petal-input-source';
import { PetalNativeVisibility } from '@/main/desktop-petals/petal-native-visibility';

/** Tracks one active gesture and delivers display-independent coordinates to consumers. */
export class PetalInputMonitor {
  private helper?: ChildProcessWithoutNullStreams;
  private ready = false;
  private disposed = false;
  private restarts = 0;
  private retry?: ReturnType<typeof setTimeout>;
  private serial = 0;
  private watch?: { id: number; callback(point: Point, released: boolean): void; unavailable?(): void };
  private timer?: ReturnType<typeof setInterval>;
  private readonly visibility = new PetalNativeVisibility((line) => {
    if (process.platform !== 'win32' || !this.ready || !this.helper?.stdin.writable) return false;
    this.helper.stdin.write(line);
    return true;
  });
  sampleVisibility(handles: readonly string[]) {
    return this.visibility.read(handles);
  }
  constructor(
    private readonly toggleTitles: () => Promise<void>,
    private readonly desktopShown = () => {},
  ) {}
  get canWatchPointer() {
    return this.ready;
  }
  start() {
    if (this.disposed || (process.platform !== 'win32' && process.platform !== 'darwin') || this.helper) return;
    clearTimeout(this.retry);
    let executable: string;
    let arguments_: string[];
    if (process.platform === 'darwin') {
      executable = isPackagedApplication(app)
        ? path.join(process.resourcesPath, 'native', 'aiy-petal-input')
        : path.join(app.getAppPath(), '.tmp', 'native', `darwin-${process.arch}`, 'aiy-petal-input');
      arguments_ = [];
    } else {
      const script = `$ErrorActionPreference = 'Stop'\nAdd-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'\n${windowsPetalInputSource}\n'@\n[PetalInput]::Run()`;
      executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
      arguments_ = [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ];
    }
    const helper = spawn(executable, arguments_, { windowsHide: true, stdio: 'pipe' });
    this.helper = helper;
    const startedAt = performance.now();
    const lines = createInterface({ input: helper.stdout });
    lines.on('line', (line) => {
      if (line === 'ready') {
        this.ready = true;
        if (this.watch) this.send(this.watch.id);
      } else if (line === 'toggle') {
        void this.toggleTitles().catch((error) => console.error('[desktop-petals] title toggle failed', error));
      } else if (line === 'desktop') {
        this.desktopShown();
      } else if (!this.visibility.receive(line)) this.pointerSignal(line);
    });
    helper.stdin.on('error', () => undefined);
    helper.stderr.resume();
    helper.once('error', (error) => console.error('[desktop-petals] input helper unavailable', error));
    helper.once('close', (code) => {
      lines.close();
      if (this.helper !== helper) return;
      this.ready = false;
      this.visibility.dispose();
      this.helper = undefined;
      const unavailable = this.watch?.unavailable;
      this.stopPointer();
      unavailable?.();
      if (code) console.error('[desktop-petals] input helper exited', code);
      if (performance.now() - startedAt >= 60_000) this.restarts = 0;
      if (!this.disposed && this.restarts < 3) {
        const delay = [1_000, 5_000, 30_000][this.restarts++];
        this.retry = setTimeout(() => this.start(), delay);
        this.retry.unref();
      }
    });
  }
  private pointerSignal(line: string) {
    const watch = this.watch;
    if (!watch) return;
    if (process.platform === 'darwin') {
      if (line !== `released:${watch.id}`) return;
      this.stopPointer();
      watch.callback(screen.getCursorScreenPoint(), true);
      return;
    }
    const release = parseWindowsPetalRelease(line, watch.id);
    if (!release) return;
    this.stopPointer();
    if (release.kind === 'unavailable') {
      watch.unavailable?.();
      return;
    }
    let point: Point;
    try {
      // Convert the frozen native sample using its display, not a global scale factor.
      point = screen.screenToDipPoint(release.point);
    } catch (error) {
      console.error('[desktop-petals] release coordinate conversion failed', error);
      watch.unavailable?.();
      return;
    }
    watch.callback(point, true);
  }
  private send(id: number) {
    if (this.ready && this.helper?.stdin.writable) this.helper.stdin.write(`${id}\n`);
  }
  watchPointer(callback: (point: Point, released: boolean) => void, unavailable?: () => void) {
    this.stopPointer();
    const id = ++this.serial;
    this.watch = { id, callback, unavailable };
    this.send(id);
    this.timer = setInterval(() => {
      if (this.watch?.id === id) callback(screen.getCursorScreenPoint(), false);
    }, 16);
    return () => {
      if (this.watch?.id === id) this.stopPointer();
    };
  }
  private stopPointer() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.watch = undefined;
    this.send(0);
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.retry);
    this.visibility.dispose();
    this.stopPointer();
    const helper = this.helper;
    this.helper = undefined;
    this.ready = false;
    // EOF also shuts the native message loop down if the Electron parent crashes.
    helper?.stdin.end('quit\n');
  }
}
