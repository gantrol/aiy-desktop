import { spawn, type ChildProcessByStdio } from 'node:child_process';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';

const STORE_HELPER_PROTOCOL_VERSION = 2;
const MAX_HELPER_STDOUT_BYTES = 512 * 1_024;
const MAX_HELPER_STDERR_BYTES = 64 * 1_024;
const MAX_HELPER_LINE_CHARACTERS = 16 * 1_024;
const STORE_CHECK_TIMEOUT_MS = 2 * 60 * 1_000;
const STORE_UPDATE_TIMEOUT_MS = 2 * 60 * 60 * 1_000;

const helperErrorCodeSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Z0-9_]+$/);
const helperPackageVersionSchema = z
  .object({
    major: z.number().int().min(0).max(65_535),
    minor: z.number().int().min(0).max(65_535),
    build: z.number().int().min(0).max(65_535),
    revision: z.number().int().min(0).max(65_535),
  })
  .strict();
const helperProgressSchema = z
  .object({
    type: z.literal('progress'),
    operation: z.enum(['DOWNLOAD', 'INSTALL']),
    percent: z.number().int().min(0).max(100),
    transferred: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    state: z.enum([
      'PENDING',
      'DOWNLOADING',
      'DEPLOYING',
      'COMPLETED',
      'CANCELED',
      'OTHER_ERROR',
      'LOW_BATTERY',
      'WIFI_RECOMMENDED',
      'WIFI_REQUIRED',
      'UNKNOWN',
    ]),
  })
  .strict();
const helperCheckResultSchema = z
  .object({
    type: z.literal('check-result'),
    available: z.boolean(),
    targetVersion: helperPackageVersionSchema.nullable(),
  })
  .strict();
const helperOperationResultSchema = z
  .object({
    type: z.literal('operation-result'),
    operation: z.enum(['DOWNLOAD', 'INSTALL']),
    status: z.literal('COMPLETED'),
    targetVersion: helperPackageVersionSchema,
  })
  .strict();
const helperActivationResultSchema = z
  .object({
    type: z.literal('activation-result'),
    status: z.literal('COMPLETED'),
  })
  .strict();
const helperErrorSchema = z
  .object({
    type: z.literal('error'),
    code: helperErrorCodeSchema,
    retryable: z.boolean(),
  })
  .strict();
const helperProtocolSchema = z
  .object({ type: z.literal('protocol'), version: z.literal(STORE_HELPER_PROTOCOL_VERSION) })
  .strict();
const helperMessageSchema = z.discriminatedUnion('type', [
  helperProgressSchema,
  helperCheckResultSchema,
  helperOperationResultSchema,
  helperActivationResultSchema,
  helperErrorSchema,
  helperProtocolSchema,
]);

export interface WindowsStoreCheckResult {
  available: boolean;
  targetStoreVersion: string | null;
}

export interface WindowsStoreOperationResult {
  targetStoreVersion: string;
}

export interface WindowsStoreProgress {
  percent: number;
  transferred: number;
  total: number;
}

export interface WindowsStoreUpdateBackend {
  check(): Promise<WindowsStoreCheckResult>;
  download(
    ownerWindowHandle: Buffer,
    onProgress: (progress: WindowsStoreProgress) => void,
  ): Promise<WindowsStoreOperationResult>;
  install(ownerWindowHandle: Buffer): Promise<WindowsStoreOperationResult>;
  activate(): Promise<void>;
  dispose(): void;
}

export class WindowsStoreUpdateError extends Error {
  readonly name = 'WindowsStoreUpdateError';

  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}

type HelperTerminalMessage =
  | z.infer<typeof helperCheckResultSchema>
  | z.infer<typeof helperOperationResultSchema>
  | z.infer<typeof helperActivationResultSchema>
  | z.infer<typeof helperErrorSchema>;
type StoreHelperProcess = ChildProcessByStdio<null, Readable, Readable>;

function sanitizedHelperEnvironment() {
  const allowedNames = new Set([
    'appdata',
    'commonprogramfiles',
    'commonprogramfiles(x86)',
    'localappdata',
    'programdata',
    'programfiles',
    'programfiles(x86)',
    'systemdrive',
    'systemroot',
    'temp',
    'tmp',
    'userprofile',
    'windir',
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => allowedNames.has(entry[0].toLowerCase()) && entry[1] !== undefined,
    ),
  );
}

function windowHandleAsDecimal(handle: Buffer) {
  if (handle.length !== 4 && handle.length !== 8) {
    throw new WindowsStoreUpdateError('STORE_WINDOW_HANDLE_INVALID', false);
  }
  let value = 0n;
  for (let index = handle.length - 1; index >= 0; index -= 1) value = (value << 8n) | BigInt(handle[index]);
  if (value === 0n) throw new WindowsStoreUpdateError('STORE_WINDOW_UNAVAILABLE', true);
  return value.toString(10);
}

function packageVersionText(version: z.infer<typeof helperPackageVersionSchema>) {
  return `${version.major}.${version.minor}.${version.build}.${version.revision}`;
}

export class WindowsStoreUpdateClient implements WindowsStoreUpdateBackend {
  private readonly children = new Set<StoreHelperProcess>();
  private disposed = false;

  constructor(
    private readonly executablePath = path.join(process.resourcesPath, 'store-update', 'aiy-store-update.exe'),
  ) {}

  async check(): Promise<WindowsStoreCheckResult> {
    const result = await this.run(['check'], STORE_CHECK_TIMEOUT_MS);
    if (result.type === 'error') throw new WindowsStoreUpdateError(result.code, result.retryable);
    if (result.type !== 'check-result') throw new WindowsStoreUpdateError('STORE_HELPER_PROTOCOL_INVALID', false);
    if (result.available !== (result.targetVersion !== null)) {
      throw new WindowsStoreUpdateError('STORE_HELPER_PROTOCOL_INVALID', false);
    }
    return {
      available: result.available,
      targetStoreVersion: result.targetVersion ? packageVersionText(result.targetVersion) : null,
    };
  }

  async download(ownerWindowHandle: Buffer, onProgress: (progress: WindowsStoreProgress) => void) {
    const result = await this.run(
      ['download', '--window-handle', windowHandleAsDecimal(ownerWindowHandle)],
      STORE_UPDATE_TIMEOUT_MS,
      (progress) => {
        if (progress.operation !== 'DOWNLOAD') return;
        onProgress({
          percent: progress.percent,
          transferred: progress.transferred,
          total: progress.total,
        });
      },
    );
    if (result.type === 'error') throw new WindowsStoreUpdateError(result.code, result.retryable);
    if (result.type !== 'operation-result' || result.operation !== 'DOWNLOAD') {
      throw new WindowsStoreUpdateError('STORE_HELPER_PROTOCOL_INVALID', false);
    }
    return { targetStoreVersion: packageVersionText(result.targetVersion) };
  }

  async install(ownerWindowHandle: Buffer) {
    const result = await this.run(
      [
        'install',
        '--window-handle',
        windowHandleAsDecimal(ownerWindowHandle),
        '--parent-process-id',
        process.pid.toString(10),
      ],
      STORE_UPDATE_TIMEOUT_MS,
      undefined,
      true,
    );
    if (result.type === 'error') throw new WindowsStoreUpdateError(result.code, result.retryable);
    if (result.type !== 'operation-result' || result.operation !== 'INSTALL') {
      throw new WindowsStoreUpdateError('STORE_HELPER_PROTOCOL_INVALID', false);
    }
    return { targetStoreVersion: packageVersionText(result.targetVersion) };
  }

  async activate() {
    const result = await this.run(['activate'], STORE_CHECK_TIMEOUT_MS);
    if (result.type === 'error') throw new WindowsStoreUpdateError(result.code, result.retryable);
    if (result.type !== 'activation-result') {
      throw new WindowsStoreUpdateError('STORE_HELPER_PROTOCOL_INVALID', false);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const child of this.children) child.kill();
    this.children.clear();
  }

  private run(
    arguments_: string[],
    timeoutMs: number,
    onProgress?: (progress: z.infer<typeof helperProgressSchema>) => void,
    resolveSuccessfulOperationBeforeExit = false,
  ): Promise<HelperTerminalMessage> {
    if (this.disposed) return Promise.reject(new WindowsStoreUpdateError('STORE_CLIENT_DISPOSED', false));

    return new Promise((resolve, reject) => {
      let child: StoreHelperProcess;
      try {
        child = spawn(this.executablePath, arguments_, {
          detached: resolveSuccessfulOperationBeforeExit,
          env: sanitizedHelperEnvironment(),
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch {
        reject(new WindowsStoreUpdateError('STORE_HELPER_LAUNCH_FAILED', false));
        return;
      }

      this.children.add(child);
      const decoder = new StringDecoder('utf8');
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let pendingLine = '';
      let terminal: HelperTerminalMessage | null = null;
      let failure: WindowsStoreUpdateError | null = null;
      let completed = false;

      const resolveBeforeExit = () => {
        if (completed || terminal?.type !== 'operation-result') return;
        // The detached helper now owns relaunch and must outlive the old Electron process.
        completed = true;
        clearTimeout(timeout);
        this.children.delete(child);
        child.stdout.removeAllListeners();
        child.stderr.removeAllListeners();
        child.removeAllListeners();
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        resolve(terminal);
      };

      const stopWith = (error: WindowsStoreUpdateError) => {
        if (failure) return;
        failure = error;
        child.kill();
      };
      const consumeLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (trimmed.length > MAX_HELPER_LINE_CHARACTERS || terminal) {
          stopWith(new WindowsStoreUpdateError('STORE_HELPER_PROTOCOL_INVALID', false));
          return;
        }
        let rawMessage: unknown;
        try {
          rawMessage = JSON.parse(trimmed) as unknown;
        } catch {
          stopWith(new WindowsStoreUpdateError('STORE_HELPER_PROTOCOL_INVALID', false));
          return;
        }
        const parsedMessage = helperMessageSchema.safeParse(rawMessage);
        if (!parsedMessage.success || parsedMessage.data.type === 'protocol') {
          stopWith(new WindowsStoreUpdateError('STORE_HELPER_PROTOCOL_INVALID', false));
          return;
        }
        if (parsedMessage.data.type === 'progress') {
          onProgress?.(parsedMessage.data);
          return;
        }
        terminal = parsedMessage.data;
        if (resolveSuccessfulOperationBeforeExit) resolveBeforeExit();
      };
      const consumeText = (text: string) => {
        pendingLine += text;
        const lines = pendingLine.split(/\r?\n/);
        pendingLine = lines.pop() ?? '';
        if (pendingLine.length > MAX_HELPER_LINE_CHARACTERS) {
          stopWith(new WindowsStoreUpdateError('STORE_HELPER_PROTOCOL_INVALID', false));
          return;
        }
        for (const line of lines) consumeLine(line);
      };

      const timeout = setTimeout(() => {
        stopWith(new WindowsStoreUpdateError('STORE_HELPER_TIMEOUT', true));
      }, timeoutMs);
      timeout.unref();

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_HELPER_STDOUT_BYTES) {
          stopWith(new WindowsStoreUpdateError('STORE_HELPER_OUTPUT_LIMIT', false));
          return;
        }
        consumeText(decoder.write(chunk));
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > MAX_HELPER_STDERR_BYTES) {
          stopWith(new WindowsStoreUpdateError('STORE_HELPER_OUTPUT_LIMIT', false));
        }
      });
      child.on('error', () => {
        failure = new WindowsStoreUpdateError('STORE_HELPER_LAUNCH_FAILED', false);
      });
      child.on('close', (code, signal) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        this.children.delete(child);
        consumeText(decoder.end());
        if (pendingLine.trim()) consumeLine(pendingLine);
        if (failure) {
          reject(failure);
          return;
        }
        if (!terminal || code !== (terminal.type === 'error' ? 1 : 0) || signal !== null) {
          reject(new WindowsStoreUpdateError('STORE_HELPER_EXITED', true));
          return;
        }
        resolve(terminal);
      });
    });
  }
}
