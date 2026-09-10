import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { screen, type Point } from 'electron';
import { windowsPetalInputSource } from '@/main/desktop-petals/windows-petal-input-source';

/** Tracks a single active gesture. Coordinates come from Electron in display-independent pixels. */
export class PetalInputMonitor {
  private helper?: ChildProcessWithoutNullStreams;
  private ready = false;
  private serial = 0;
  private watch?: { id: number; callback(point: Point, released: boolean): void; unavailable?(): void };
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    private readonly toggleTitles: () => Promise<void>,
    private readonly desktopShown = () => {},
  ) {}
  get canWatchPointer() {
    return this.ready;
  }
  start() {
    if (process.platform !== 'win32' || this.helper) return;
    const script = `$ErrorActionPreference = 'Stop'\nAdd-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'\n${windowsPetalInputSource}\n'@\n[PetalInput]::Run()`;
    const executable = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32/WindowsPowerShell/v1.0/powershell.exe',
    );
    const helper = spawn(
      executable,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      {
        windowsHide: true,
        stdio: 'pipe',
      },
    );
    this.helper = helper;
    const lines = createInterface({ input: helper.stdout });
    lines.on('line', (line) => {
      if (line === 'ready') {
        this.ready = true;
        if (this.watch) this.send(this.watch.id);
      } else if (line === 'toggle') {
        void this.toggleTitles().catch((error) => console.error('[desktop-petals] title toggle failed', error));
      } else if (line === 'desktop') {
        this.desktopShown();
      } else if (this.watch && line === `released:${this.watch.id}`) {
        const { callback } = this.watch;
        this.stopPointer();
        callback(screen.getCursorScreenPoint(), true);
      }
    });
    helper.stdin.on('error', () => undefined);
    helper.stderr.resume();
    helper.once('error', (error) => console.error('[desktop-petals] input helper unavailable', error));
    helper.once('exit', (code) => {
      lines.close();
      if (this.helper !== helper) return;
      this.ready = false;
      this.helper = undefined;
      const unavailable = this.watch?.unavailable;
      this.stopPointer();
      unavailable?.();
      if (code) console.error('[desktop-petals] input helper exited', code);
    });
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
    this.stopPointer();
    const helper = this.helper;
    this.helper = undefined;
    this.ready = false;
    // EOF also shuts the native message loop down if the Electron parent crashes.
    helper?.stdin.end('quit\n');
  }
}
