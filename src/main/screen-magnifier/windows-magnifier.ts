import { spawn } from 'node:child_process';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { BrowserWindow } from 'electron';
import type { ScreenMagnifierSettings } from '@/shared/contracts/screen-magnifier';
import nativeSource from '@/main/screen-magnifier/windows-magnifier.cs?raw';

const sizes = { small: [320, 160], medium: [520, 200], large: [760, 260] } as const;

/** Only fixed host code and validated numbers enter this helper. No screen pixels leave it. */
export function startWindowsMagnifier(
  owner: BrowserWindow,
  settings: () => ScreenMagnifierSettings,
  mayContinue: () => boolean,
  onReady: () => void,
  onExit: (failed: boolean) => void,
) {
  const handle = owner.getNativeWindowHandle().readBigUInt64LE();
  const initial = settings();
  const [width, height] = sizes[initial.size];
  // Send source through stdin rather than exceeding Windows' command-line limit.
  const script = [
    "$ErrorActionPreference='Stop'",
    '$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::ReadLine()))',
    'Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition $source',
    `[AiyScreenMagnifier]::Run(${handle},${process.pid},${initial.scale},${width},${height})`,
  ].join('\n');
  const child = spawn(
    path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Sta',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    { windowsHide: true, stdio: 'pipe' },
  );
  let finished = false;
  let ready = false;
  const lines = createInterface({ input: child.stdout });
  const finish = (failed: boolean) => {
    if (finished) return;
    finished = true;
    clearTimeout(startup);
    clearInterval(heartbeat);
    lines.close();
    child.stdin.destroy();
    if (child.exitCode === null) child.kill();
    onExit(failed);
  };
  const startup = setTimeout(() => finish(true), 15_000);
  const heartbeat = setInterval(() => {
    if (!mayContinue()) {
      finish(false);
      return;
    }
    // A stalled pipe gets no unbounded queue. Native expiry closes the session.
    if (!child.stdin.destroyed && child.stdin.writableLength === 0) {
      const current = settings();
      const [width, height] = sizes[current.size];
      child.stdin.write(`ping:${current.scale}:${width}:${height}\n`);
    }
  }, 500);
  startup.unref();
  heartbeat.unref();
  child.stdin.on('error', () => finish(true));
  child.on('error', () => finish(true));
  child.on('exit', (code) => finish(code !== 0));
  // Drain errors; never expose native output or screen-related details to renderer.
  child.stderr.resume();
  lines.on('line', (line) => {
    if (line !== 'ready' || finished || ready) return;
    ready = true;
    clearTimeout(startup);
    onReady();
  });
  child.stdin.write(`${Buffer.from(nativeSource, 'utf8').toString('base64')}\n`);
  return () => finish(false);
}
