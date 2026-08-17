import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { decodeProviderResponseJson } from '@/main/providers/provider-response';
import {
  localQwenAsrGpuTelemetrySchema,
  localQwenAsrSidecarSchema,
  type LocalQwenAsrGpuTelemetry,
  type LocalQwenAsrSidecarDto,
  type LocalQwenAsrSidecarErrorCode,
} from '@/shared/contracts/video-document';

export const LOCAL_QWEN_ASR_MODEL_ID = 'Qwen/Qwen3-ASR-0.6B' as const;
export const LOCAL_QWEN_ASR_PROVIDER_KEY = 'qwen-local' as const;

const DEFAULT_WSL_DISTRIBUTION = 'Ubuntu';
const STARTUP_TIMEOUT_MS = 5 * 60_000;
const HEALTH_REQUEST_TIMEOUT_MS = 3_000;
const HEALTH_RETRY_DELAY_MS = 500;
const PROCESS_STOP_TIMEOUT_MS = 5_000;
const PROCESS_OUTPUT_LIMIT_BYTES = 64 * 1024;
const PREFLIGHT_TIMEOUT_MS = 20_000;
const PREFLIGHT_SUCCESS_CACHE_MS = 60_000;
const PREFLIGHT_FAILURE_CACHE_MS = 5_000;
const GPU_TELEMETRY_TIMEOUT_MS = 5_000;
const IDLE_SHUTDOWN_DELAY_MS = 2 * 60_000;
const WSL_DISTRIBUTION_SCHEMA = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);

const modelsResponseSchema = z
  .object({
    data: z.array(z.object({ id: z.string().trim().min(1).max(500) }).passthrough()).max(10_000),
  })
  .passthrough();

const loopbackBaseUrlSchema = z
  .string()
  .max(100)
  .superRefine((value, context) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'Local Qwen ASR URL is invalid' });
      return;
    }
    const port = Number(parsed.port);
    if (
      parsed.protocol !== 'http:' ||
      parsed.hostname !== '127.0.0.1' ||
      parsed.pathname !== '/v1' ||
      parsed.search ||
      parsed.hash ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65_535
    ) {
      context.addIssue({ code: 'custom', message: 'Local Qwen ASR URL must be a loopback v1 endpoint' });
    }
  });

const WSL_PREFLIGHT_SCRIPT = String.raw`
set -eu
root="$HOME/.local/share/catai-qwen-asr"
serve="\$root/venv/bin/qwen-asr-serve"
model="\$root/models/Qwen3-ASR-0.6B"
if [ ! -x "\$serve" ]; then printf 'RUNTIME_NOT_INSTALLED'; exit 20; fi
if [ ! -d "\$model" ]; then printf 'MODEL_NOT_INSTALLED'; exit 21; fi
printf 'RUNTIME_READY'
`;

const WSL_LAUNCHER_SCRIPT = String.raw`
set -eu
IFS= read -r aiy_token
IFS= read -r aiy_port
case "\$aiy_token" in ''|*[!A-Za-z0-9_-]*) exit 64 ;; esac
case "\$aiy_port" in ''|*[!0-9]*) exit 65 ;; esac
root="$HOME/.local/share/catai-qwen-asr"
serve="\$root/venv/bin/qwen-asr-serve"
model="\$root/models/Qwen3-ASR-0.6B"
test -x "\$serve" || exit 70
test -d "\$model" || exit 71
exec "\$serve" "\$model" \
  --served-model-name Qwen/Qwen3-ASR-0.6B \
  --host 127.0.0.1 \
  --port "\$aiy_port" \
  --api-key "\$aiy_token" \
  --allowed-origins '[]' \
  --disable-fastapi-docs \
  --dtype bfloat16 \
  --gpu-memory-utilization 0.55 \
  --max-model-len 8192 \
  --max-num-seqs 1
`;

const WSL_GPU_TELEMETRY_SCRIPT = String.raw`
set -eu
command -v nvidia-smi >/dev/null 2>&1 || exit 30
nvidia-smi \
  --query-gpu=index,utilization.gpu,memory.used,memory.total,power.draw \
  --format=csv,noheader,nounits
`;

const gpuTelemetryRowSchema = z.tuple([
  z.string().trim().min(1).max(20),
  z.string().trim().min(1).max(20),
  z.string().trim().min(1).max(30),
  z.string().trim().min(1).max(30),
  z.string().trim().min(1).max(30),
]);

interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  error: Error | null;
}

interface ManagedProcess {
  child: ChildProcessWithoutNullStreams;
  exited: Promise<ProcessExit>;
  exit: ProcessExit | null;
  intentionalStop: boolean;
  termination: Promise<void> | null;
}

interface CapturedProcessResult {
  code: number | null;
  stdout: string;
}

export interface LocalQwenAsrCredentials {
  providerKey: typeof LOCAL_QWEN_ASR_PROVIDER_KEY;
  apiKey: string;
  baseUrl: string;
  modelId: typeof LOCAL_QWEN_ASR_MODEL_ID;
  configurationRevision: string;
  verified: true;
}

interface LocalQwenAsrSidecarManagerOptions {
  distribution?: string;
  fetchImpl?: typeof fetch;
}

export class LocalQwenAsrSidecarError extends Error {
  constructor(
    readonly errorCode: LocalQwenAsrSidecarErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'LocalQwenAsrSidecarError';
  }
}

function sidecarError(errorCode: LocalQwenAsrSidecarErrorCode, message: string, cause?: unknown) {
  return new LocalQwenAsrSidecarError(errorCode, message, cause);
}

function abortError(cause?: unknown) {
  const error = new Error('Local Qwen ASR operation was cancelled', { cause });
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal.reason);
}

function windowsSystemExecutable(fileName: 'wsl.exe' | 'taskkill.exe') {
  const systemRoot = process.env.SystemRoot?.trim() || 'C:\\Windows';
  const resolvedRoot = path.win32.resolve(systemRoot);
  if (!path.win32.isAbsolute(resolvedRoot)) throw sidecarError('WSL_UNAVAILABLE', 'Windows system root is invalid');
  return path.win32.join(resolvedRoot, 'System32', fileName);
}

function normalizeProcessOutput(chunks: readonly Buffer[]) {
  return Buffer.concat(chunks).toString('utf8').replaceAll('\0', '').trim();
}

function captureBounded(stream: NodeJS.ReadableStream, chunks: Buffer[]) {
  let capturedBytes = 0;
  stream.on('data', (raw: unknown) => {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw));
    if (capturedBytes >= PROCESS_OUTPUT_LIMIT_BYTES) return;
    const bounded = chunk.subarray(0, PROCESS_OUTPUT_LIMIT_BYTES - capturedBytes);
    chunks.push(bounded);
    capturedBytes += bounded.length;
  });
}

function spawnManaged(file: string, args: readonly string[]): ManagedProcess {
  const child = spawn(file, [...args], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const session: ManagedProcess = {
    child,
    exited: Promise.resolve({ code: null, signal: null, error: null }),
    exit: null,
    intentionalStop: false,
    termination: null,
  };
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  captureBounded(child.stdout, stdout);
  captureBounded(child.stderr, stderr);
  session.exited = new Promise<ProcessExit>((resolve) => {
    let settled = false;
    const finish = (exit: ProcessExit) => {
      if (settled) return;
      settled = true;
      session.exit = exit;
      resolve(exit);
    };
    child.once('error', (error) => finish({ code: null, signal: null, error }));
    child.once('close', (code, signal) => finish({ code, signal, error: null }));
  });
  return session;
}

async function runCapturedProcess(
  file: string,
  args: readonly string[],
  options: { signal?: AbortSignal; timeoutMs: number },
): Promise<CapturedProcessResult> {
  throwIfAborted(options.signal);
  const child = spawn(file, [...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  captureBounded(child.stdout, stdout);
  captureBounded(child.stderr, stderr);
  let timedOut = false;
  const terminate = () => {
    if (child.exitCode === null) child.kill();
  };
  const onAbort = () => terminate();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    terminate();
  }, options.timeoutMs);
  timeout.unref?.();
  try {
    const result = await new Promise<{ code: number | null; error: Error | null }>((resolve) => {
      let settled = false;
      const finish = (value: { code: number | null; error: Error | null }) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      child.once('error', (error) => finish({ code: null, error }));
      child.once('close', (code) => finish({ code, error: null }));
    });
    if (options.signal?.aborted) throw abortError(options.signal.reason);
    if (timedOut) throw sidecarError('WSL_UNAVAILABLE', 'WSL command timed out');
    if (result.error) {
      const code = (result.error as NodeJS.ErrnoException).code;
      throw sidecarError(code === 'ENOENT' ? 'WSL_UNAVAILABLE' : 'UNKNOWN', 'WSL command failed', result.error);
    }
    return { code: result.code, stdout: normalizeProcessOutput(stdout) };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

async function reserveLoopbackPort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', (error) => reject(sidecarError('PORT_UNAVAILABLE', 'No loopback port is available', error)));
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((error) => {
        if (error || !port) reject(sidecarError('PORT_UNAVAILABLE', 'No loopback port is available', error));
        else resolve(port);
      });
    });
  });
}

async function waitForExit(session: ManagedProcess, timeoutMs: number) {
  if (session.exit) return true;
  const result = await Promise.race([session.exited.then(() => true), delay(timeoutMs, false, { ref: false })]);
  return result;
}

async function terminateProcessTree(session: ManagedProcess) {
  if (session.termination) return session.termination;
  session.intentionalStop = true;
  session.termination = (async () => {
    if (session.exit) return;
    session.child.kill();
    if (await waitForExit(session, PROCESS_STOP_TIMEOUT_MS)) return;
    const pid = session.child.pid;
    if (pid && Number.isSafeInteger(pid) && pid > 0) {
      await runCapturedProcess(windowsSystemExecutable('taskkill.exe'), ['/PID', String(pid), '/T', '/F'], {
        timeoutMs: PROCESS_STOP_TIMEOUT_MS,
      }).catch(() => undefined);
    }
    if (await waitForExit(session, PROCESS_STOP_TIMEOUT_MS)) return;
    session.child.kill('SIGKILL');
    if (!(await waitForExit(session, PROCESS_STOP_TIMEOUT_MS))) {
      throw sidecarError('STOP_FAILED', 'Managed local Qwen ASR service did not stop');
    }
  })();
  return session.termination;
}

function runtimeStatusFor(errorCode: LocalQwenAsrSidecarErrorCode) {
  return errorCode === 'RUNTIME_NOT_INSTALLED' || errorCode === 'MODEL_NOT_INSTALLED' ? 'NOT_INSTALLED' : 'ERROR';
}

function finiteMetric(value: string, minimum: number, maximum: number) {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function parseGpuTelemetry(output: string): LocalQwenAsrGpuTelemetry | null {
  const candidates = output
    .split(/\r?\n/)
    .map((line) => gpuTelemetryRowSchema.safeParse(line.split(',')))
    .flatMap((result) => (result.success ? [result.data] : []))
    .flatMap(([rawIndex, rawUtilization, rawUsed, rawTotal, rawPower]) => {
      const gpuIndex = finiteMetric(rawIndex, 0, 1_024);
      const utilizationPercent = finiteMetric(rawUtilization, 0, 100);
      const memoryUsedMiB = finiteMetric(rawUsed, 0, 10_000_000);
      const memoryTotalMiB = finiteMetric(rawTotal, 1, 10_000_000);
      const powerWatts = finiteMetric(rawPower, 0, 5_000);
      if (gpuIndex === null || utilizationPercent === null || memoryUsedMiB === null || memoryTotalMiB === null) {
        return [];
      }
      const parsed = localQwenAsrGpuTelemetrySchema.safeParse({
        sampledAt: new Date().toISOString(),
        gpuIndex,
        utilizationPercent,
        memoryUsedMiB,
        memoryTotalMiB,
        powerWatts,
      });
      return parsed.success ? [parsed.data] : [];
    });
  return candidates.sort((left, right) => right.memoryUsedMiB - left.memoryUsedMiB)[0] ?? null;
}

export class LocalQwenAsrSidecarManager {
  private readonly distribution: string;
  private readonly fetchImpl: typeof fetch;
  private state: LocalQwenAsrSidecarDto;
  private session: ManagedProcess | null = null;
  private activeCredentials: LocalQwenAsrCredentials | null = null;
  private startPromise: Promise<LocalQwenAsrCredentials> | null = null;
  private startController: AbortController | null = null;
  private stopPromise: Promise<LocalQwenAsrSidecarDto> | null = null;
  private telemetryPromise: Promise<LocalQwenAsrGpuTelemetry | null> | null = null;
  private readonly operationControllers = new Set<AbortController>();
  private lastPreflightAttemptAt = 0;
  private lastSuccessfulPreflightAt = 0;
  private idleShutdownTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(options: LocalQwenAsrSidecarManagerOptions = {}) {
    this.distribution = WSL_DISTRIBUTION_SCHEMA.parse(
      options.distribution?.trim() || process.env.AIY_QWEN_ASR_WSL_DISTRIBUTION?.trim() || DEFAULT_WSL_DISTRIBUTION,
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.state = this.dto(
      process.platform === 'win32' ? 'STOPPED' : 'ERROR',
      process.platform === 'win32' ? null : 'UNSUPPORTED_PLATFORM',
    );
  }

  status() {
    if (this.state.status === 'READY' && (!this.session || this.session.exit || !this.activeCredentials)) {
      this.state = this.dto('ERROR', 'START_FAILED');
    }
    return this.state;
  }

  async inspect(signal?: AbortSignal) {
    if (this.state.status === 'READY' || this.state.status === 'STARTING') {
      const current = this.status();
      if (current.status !== 'READY' && current.status !== 'STARTING') return current;
      let telemetry: LocalQwenAsrGpuTelemetry | null = null;
      try {
        telemetry = await this.readGpuTelemetry(signal);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
      }
      this.state = this.dto(current.status, current.errorCode, telemetry);
      return this.state;
    }
    if (this.state.status !== 'STOPPED' && Date.now() - this.lastPreflightAttemptAt <= PREFLIGHT_FAILURE_CACHE_MS) {
      return this.state;
    }
    try {
      await this.preflight(signal);
      this.state = this.dto('STOPPED', null);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      const normalized = this.normalizeError(error);
      this.state = this.dto(runtimeStatusFor(normalized.errorCode), normalized.errorCode);
    }
    return this.state;
  }

  credentials(): LocalQwenAsrCredentials | null {
    if (this.status().status !== 'READY' || !this.activeCredentials) return null;
    return Object.freeze({ ...this.activeCredentials });
  }

  registerOperation(controller: AbortController) {
    this.clearIdleShutdown();
    if (this.disposed) controller.abort();
    else this.operationControllers.add(controller);
    let registered = !this.disposed;
    return () => {
      if (!registered) return;
      registered = false;
      this.operationControllers.delete(controller);
      this.scheduleIdleShutdown();
    };
  }

  async start(signal?: AbortSignal) {
    await this.ensureReady(signal);
    return this.status();
  }

  async ensureReady(signal?: AbortSignal): Promise<LocalQwenAsrCredentials> {
    throwIfAborted(signal);
    if (this.disposed) throw sidecarError('START_FAILED', 'Managed local Qwen ASR service is disposed');
    this.clearIdleShutdown();
    if (this.stopPromise) await this.awaitSharedOperation(this.stopPromise, signal);
    throwIfAborted(signal);
    const existing = this.credentials();
    if (existing) {
      this.scheduleIdleShutdown();
      return existing;
    }
    if (this.startPromise) return this.awaitSharedOperation(this.startPromise, signal);

    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) controller.abort(signal.reason);
    this.startController = controller;
    this.state = this.dto('STARTING', null);
    const operation = this.startInternal(controller.signal).finally(() => {
      signal?.removeEventListener('abort', onAbort);
      if (this.startPromise === operation) this.startPromise = null;
      if (this.startController === controller) this.startController = null;
    });
    this.startPromise = operation;
    return operation;
  }

  async stop() {
    this.clearIdleShutdown();
    if (this.stopPromise) return this.stopPromise;
    const operation = this.stopInternal().finally(() => {
      if (this.stopPromise === operation) this.stopPromise = null;
    });
    this.stopPromise = operation;
    return operation;
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const controller of this.operationControllers) controller.abort();
    this.operationControllers.clear();
    await this.stop();
  }

  private dto(
    status: LocalQwenAsrSidecarDto['status'],
    errorCode: LocalQwenAsrSidecarErrorCode | null,
    telemetry: LocalQwenAsrGpuTelemetry | null = null,
  ): LocalQwenAsrSidecarDto {
    return localQwenAsrSidecarSchema.parse({
      providerKey: LOCAL_QWEN_ASR_PROVIDER_KEY,
      status,
      modelId: LOCAL_QWEN_ASR_MODEL_ID,
      errorCode,
      telemetry,
    });
  }

  private async readGpuTelemetry(signal?: AbortSignal) {
    if (this.telemetryPromise) return this.awaitSharedOperation(this.telemetryPromise, signal);
    const operation = runCapturedProcess(
      windowsSystemExecutable('wsl.exe'),
      ['-d', this.distribution, '--', 'sh', '-lc', WSL_GPU_TELEMETRY_SCRIPT],
      { signal, timeoutMs: GPU_TELEMETRY_TIMEOUT_MS },
    )
      .then((result) => (result.code === 0 ? parseGpuTelemetry(result.stdout) : null))
      .finally(() => {
        if (this.telemetryPromise === operation) this.telemetryPromise = null;
      });
    this.telemetryPromise = operation;
    return this.awaitSharedOperation(operation, signal);
  }

  private async preflight(signal?: AbortSignal) {
    throwIfAborted(signal);
    this.lastPreflightAttemptAt = Date.now();
    if (process.platform !== 'win32') {
      throw sidecarError('UNSUPPORTED_PLATFORM', 'Managed WSL Qwen ASR requires Windows');
    }
    const executable = windowsSystemExecutable('wsl.exe');
    if (!existsSync(executable)) throw sidecarError('WSL_UNAVAILABLE', 'WSL is unavailable');
    if (Date.now() - this.lastSuccessfulPreflightAt <= PREFLIGHT_SUCCESS_CACHE_MS) return;
    const result = await runCapturedProcess(
      executable,
      ['-d', this.distribution, '--', 'sh', '-lc', WSL_PREFLIGHT_SCRIPT],
      { signal, timeoutMs: PREFLIGHT_TIMEOUT_MS },
    );
    if (result.stdout.includes('RUNTIME_NOT_INSTALLED')) {
      throw sidecarError('RUNTIME_NOT_INSTALLED', 'Local Qwen ASR runtime is not installed');
    }
    if (result.stdout.includes('MODEL_NOT_INSTALLED')) {
      throw sidecarError('MODEL_NOT_INSTALLED', 'Local Qwen ASR model is not installed');
    }
    if (result.code !== 0 || !result.stdout.includes('RUNTIME_READY')) {
      throw sidecarError('DISTRIBUTION_UNAVAILABLE', 'Configured WSL distribution is unavailable');
    }
    this.lastSuccessfulPreflightAt = Date.now();
  }

  private async startInternal(signal: AbortSignal) {
    try {
      await this.preflight(signal);
      throwIfAborted(signal);
      const port = await reserveLoopbackPort();
      throwIfAborted(signal);
      const token = randomBytes(32).toString('base64url');
      const baseUrl = loopbackBaseUrlSchema.parse(`http://127.0.0.1:${port}/v1`);
      const session = spawnManaged(windowsSystemExecutable('wsl.exe'), [
        '-d',
        this.distribution,
        '--',
        'sh',
        '-lc',
        WSL_LAUNCHER_SCRIPT,
      ]);
      this.session = session;
      session.exited.then(() => this.onProcessExit(session)).catch(() => undefined);
      session.child.stdin.on('error', () => undefined);
      session.child.stdin.end(`${token}\n${port}\n`);
      const credentials: LocalQwenAsrCredentials = Object.freeze({
        providerKey: LOCAL_QWEN_ASR_PROVIDER_KEY,
        apiKey: token,
        baseUrl,
        modelId: LOCAL_QWEN_ASR_MODEL_ID,
        configurationRevision: randomUUID(),
        verified: true,
      });
      await this.waitUntilHealthy(session, credentials, signal);
      throwIfAborted(signal);
      this.activeCredentials = credentials;
      this.state = this.dto('READY', null);
      this.scheduleIdleShutdown();
      return credentials;
    } catch (error) {
      const session = this.session;
      if (session) await terminateProcessTree(session).catch(() => undefined);
      this.session = null;
      this.activeCredentials = null;
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        this.state = this.dto('STOPPED', null);
        throw abortError(error);
      }
      const normalized = this.normalizeError(error);
      this.state = this.dto(runtimeStatusFor(normalized.errorCode), normalized.errorCode);
      throw normalized;
    }
  }

  private async waitUntilHealthy(session: ManagedProcess, credentials: LocalQwenAsrCredentials, signal: AbortSignal) {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      throwIfAborted(signal);
      if (session.exit) throw sidecarError('START_FAILED', 'Managed local Qwen ASR service exited during startup');
      if (await this.healthCheck(credentials, signal)) return;
      await delay(HEALTH_RETRY_DELAY_MS, undefined, { signal, ref: false }).catch((error) => {
        throw abortError(error);
      });
    }
    throw sidecarError('HEALTH_CHECK_FAILED', 'Managed local Qwen ASR service did not become ready');
  }

  private async healthCheck(credentials: LocalQwenAsrCredentials, signal: AbortSignal) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), HEALTH_REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    try {
      const response = await this.fetchImpl(`${credentials.baseUrl}/models`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${credentials.apiKey}` },
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return false;
      }
      const body = await decodeProviderResponseJson(response, modelsResponseSchema, {
        provider: 'Managed local Qwen ASR model catalog',
        maxBytes: 1024 * 1024,
      });
      return body.data.some((model) => model.id === LOCAL_QWEN_ASR_MODEL_ID);
    } catch {
      return false;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', onAbort);
    }
  }

  private async stopInternal() {
    this.startController?.abort();
    for (const controller of this.operationControllers) controller.abort();
    const session = this.session;
    if (session) await terminateProcessTree(session);
    await this.startPromise?.catch(() => undefined);
    this.session = null;
    this.activeCredentials = null;
    this.state = this.dto('STOPPED', null);
    return this.state;
  }

  private onProcessExit(session: ManagedProcess) {
    if (this.session !== session) return;
    this.clearIdleShutdown();
    this.session = null;
    this.activeCredentials = null;
    if (session.intentionalStop || this.disposed) this.state = this.dto('STOPPED', null);
    else this.state = this.dto('ERROR', 'START_FAILED');
  }

  private normalizeError(error: unknown) {
    if (error instanceof LocalQwenAsrSidecarError) return error;
    return sidecarError('UNKNOWN', 'Managed local Qwen ASR service failed', error);
  }

  private clearIdleShutdown() {
    if (this.idleShutdownTimer === null) return;
    clearTimeout(this.idleShutdownTimer);
    this.idleShutdownTimer = null;
  }

  private scheduleIdleShutdown() {
    if (
      this.disposed ||
      this.operationControllers.size > 0 ||
      this.state.status !== 'READY' ||
      this.idleShutdownTimer !== null
    ) {
      return;
    }
    this.idleShutdownTimer = setTimeout(() => {
      this.idleShutdownTimer = null;
      if (this.disposed || this.operationControllers.size > 0 || this.state.status !== 'READY') return;
      void this.stop().catch((error: unknown) => {
        console.error('[local-qwen-asr] idle shutdown failed', error);
      });
    }, IDLE_SHUTDOWN_DELAY_MS);
    this.idleShutdownTimer.unref?.();
  }

  private async awaitSharedOperation<T>(operation: Promise<T>, signal?: AbortSignal) {
    if (!signal) return operation;
    throwIfAborted(signal);
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(abortError(signal.reason));
      signal.addEventListener('abort', onAbort, { once: true });
      operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }
}
