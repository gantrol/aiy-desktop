import { spawn } from 'node:child_process';
import { app } from 'electron';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import source from '@/main/clipboard-capture/windows-clipboard.cs?raw';
import captureSource from '@/main/clipboard-capture/windows-capture.cs?raw';
import captureToolsSource from '@/main/clipboard-capture/windows-capture-tools.cs?raw';
import pasteSource from '@/main/clipboard-capture/windows-paste.cs?raw';
import iconSource from '@/main/clipboard-capture/windows-capture-icons.cs?raw';
import scrollSource from '@/main/clipboard-capture/windows-capture-scroll.cs?raw';
import recordingSource from '@/main/clipboard-capture/windows-capture-recording.cs?raw';
import recoverySource from '@/main/clipboard-capture/windows-capture-recovery.cs?raw';
import { readBoundedImageFile } from '@/main/media/bounded-image-file';
import {
  CaptureSession,
  captureActionSchema,
  captureBoundsSchema,
  type CaptureActionHandler,
} from '@/main/clipboard-capture/capture-session';
import type { CaptureSelectionMessages } from '@/shared/i18n/capture-selection';
import { CLIPBOARD_IMAGE_LIMIT } from '@/shared/contracts/clipboard-capture';
import type { ClipboardPayload } from '@/main/clipboard-capture/store';

const maxLine = 36 * 1024 * 1024;
const imageSchema = z
  .string()
  .max((CLIPBOARD_IMAGE_LIMIT * 4) / 3)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/u)
  .nullable();
const eventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ready') }),
  z.object({
    kind: z.literal('clipboard'),
    text: z.string().max(262144),
    html: z.string().max(262144),
    image: imageSchema,
    source: z.string().max(80),
    reference: z.boolean(),
  }),
  z.object({
    kind: z.literal('reply'),
    id: z.string().uuid(),
    error: z.string().nullish(),
  }),
  z.object({ kind: z.literal('error'), error: z.string() }),
  z.object({
    kind: z.literal('capture-action'),
    id: z.string().uuid(),
    action: captureActionSchema,
    image: imageSchema.unwrap().min(1),
    revision: z.number().int().nonnegative(),
    bounds: captureBoundsSchema,
    partial: z.boolean().optional(),
    cursor: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal('record-control'),
    id: z.string().uuid(),
    action: z.enum(['stop', 'cancel', 'preview', 'save']),
  }),
]);

export class WindowsClipboardClient {
  private readonly child;
  private readonly heartbeat;
  private readonly startup;
  private buffer = '';
  private stopped = false;
  private captureSession: CaptureSession | null = null;
  private recordingControl?: (action: 'stop' | 'cancel' | 'preview' | 'save') => Promise<void>;
  private readonly requests = new Map<
    string,
    { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; exclusive: boolean }
  >();
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  readonly ready = new Promise<void>((resolve, reject) => {
    this.readyResolve = resolve;
    this.readyReject = reject;
  });
  get closed() {
    return this.stopped;
  }
  constructor(onClipboard: (payload: ClipboardPayload) => Promise<void>, onError: (code: string) => void) {
    const script = [
      "$ErrorActionPreference='Stop'",
      '$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::ReadLine()))',
      'Add-Type -ReferencedAssemblies System,System.Core,System.Windows.Forms,System.Drawing,System.Web.Extensions -TypeDefinition $source',
      `[AiyClipboard]::Run(${process.pid})`,
    ].join('\n');
    this.child = spawn(
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
    const fail = () => {
      if (!this.stopped) {
        this.dispose();
        onError('native');
      }
    };
    this.startup = setTimeout(fail, 20_000);
    this.heartbeat = setInterval(() => {
      if (!this.stopped && this.child.stdin.writableLength === 0) this.send({ kind: 'ping' });
    }, 1000);
    this.startup.unref();
    this.heartbeat.unref();
    this.child.stderr.resume();
    this.child.on('error', fail);
    this.child.on('exit', fail);
    this.child.stdin.on('error', fail);
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      if (this.stopped) return;
      this.buffer += chunk;
      if (this.buffer.length > maxLine) {
        fail();
        return;
      }
      let boundary: number;
      while ((boundary = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, boundary);
        this.buffer = this.buffer.slice(boundary + 1);
        try {
          const event = eventSchema.parse(JSON.parse(line));
          if (event.kind === 'ready') {
            clearTimeout(this.startup);
            this.readyResolve();
          } else if (event.kind === 'error') onError(event.error);
          else if (event.kind === 'capture-action') {
            if (this.captureSession?.id === event.id)
              void this.captureSession
                .action(
                  event.action,
                  Buffer.from(event.image, 'base64'),
                  event.revision,
                  event.bounds,
                  event.partial,
                  event.cursor,
                )
                .catch(fail);
          } else if (event.kind === 'record-control') {
            if (this.captureSession?.id === event.id) void this.recordingControl?.(event.action).catch(fail);
          } else if (event.kind === 'reply') {
            if (this.captureSession?.id === event.id) {
              this.captureSession.finish(event.error);
              continue;
            }
            const pending = this.requests.get(event.id);
            if (!pending) continue;
            this.requests.delete(event.id);
            clearTimeout(pending.timer);
            if (event.error) pending.reject(new Error(event.error));
            else pending.resolve();
          } else {
            void onClipboard({ ...event, image: event.image ? Buffer.from(event.image, 'base64') : null })
              .catch(() => onError('storage'))
              .finally(() => {
                if (!this.stopped) this.send({ kind: 'ack' });
              });
          }
        } catch {
          fail();
          return;
        }
      }
    });
    this.child.stdin.write(
      `${Buffer.from([source, captureSource, captureToolsSource, pasteSource, iconSource, scrollSource, recordingSource, recoverySource].join('\n')).toString('base64')}\n`,
    );
    void this.ready.catch(() => undefined);
  }
  send(command: object) {
    if (this.stopped || this.child.stdin.writableLength > maxLine) throw new Error('native');
    this.child.stdin.write(JSON.stringify(command) + '\n');
  }
  async request<T extends { kind: string }>(command: T, timeout = 20_000) {
    await this.ready;
    const exclusive = command.kind !== 'configure';
    if (this.stopped || (exclusive && [...this.requests.values()].some((pending) => pending.exclusive)))
      throw new Error('busy');
    const id = randomUUID();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.dispose();
        reject(new Error('native'));
      }, timeout);
      this.requests.set(id, { resolve, reject, timer, exclusive });
      try {
        this.send({ ...command, id });
      } catch (error) {
        clearTimeout(timer);
        this.requests.delete(id);
        reject(error);
      }
    });
  }
  async capture(
    labels: CaptureSelectionMessages,
    locale: string,
    keyboard: boolean,
    perform: CaptureActionHandler,
    mode = 'region',
  ) {
    await this.ready;
    if (this.stopped) throw new Error('native');
    if (this.captureSession) throw new Error('busy');
    const session = new CaptureSession(labels, (command) => this.send(command), perform);
    this.captureSession = session;
    void session.done.catch(() => undefined);
    try {
      const recoveryFile = path.join(app.getPath('userData'), 'capture-recovery', 'scroll.png');
      let recovery: string | undefined;
      let recoveryError = false;
      try {
        await mkdir(path.dirname(recoveryFile), { recursive: true });
        const bytes = await readBoundedImageFile(recoveryFile, undefined, CLIPBOARD_IMAGE_LIMIT);
        if (
          bytes.length < 24 ||
          !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
          bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 20_000_000
        )
          throw new Error('corrupt');
        recovery = bytes.toString('base64');
      } catch (error) {
        recoveryError = (error as NodeJS.ErrnoException).code !== 'ENOENT';
      }
      if (this.captureSession !== session || this.stopped) throw new Error('cancelled');
      this.send({
        kind: 'capture',
        id: session.id,
        labels,
        locale,
        keyboard,
        mode,
        recoveryFile,
        recovery,
        recoveryError,
      });
      await session.done;
    } finally {
      if (this.captureSession === session) this.captureSession = null;
    }
  }
  focusCapture() {
    if (this.captureSession && !this.stopped) this.send({ kind: 'capture-focus', id: this.captureSession.id });
  }
  onRecordingControl(handler: NonNullable<WindowsClipboardClient['recordingControl']>) {
    this.recordingControl = handler;
    return () => {
      if (this.recordingControl === handler) this.recordingControl = undefined;
    };
  }
  recordingState(phase: 'recording' | 'ready', message: string) {
    if (this.captureSession) this.send({ kind: 'capture-record-state', id: this.captureSession.id, phase, message });
  }
  cancelCapture() {
    const session = this.captureSession;
    if (!session) return;
    if (!this.stopped) this.send({ kind: 'capture-cancel', id: session.id });
    session.finish('cancelled');
    this.captureSession = null;
  }
  dispose() {
    if (this.stopped) return;
    this.stopped = true;
    this.cancelCapture();
    clearTimeout(this.startup);
    clearInterval(this.heartbeat);
    this.readyReject(new Error('cancelled'));
    for (const pending of this.requests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('cancelled'));
    }
    this.requests.clear();
    this.buffer = '';
    this.child.stdin.destroy();
    if (this.child.exitCode === null) this.child.kill();
  }
}
