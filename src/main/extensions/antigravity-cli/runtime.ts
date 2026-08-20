import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { z } from 'zod';
import type {
  AntigravityCliModelDto,
  AntigravityCliQuotaDto,
  AntigravityCliQuotaGroupDto,
  AntigravityCliQuotaWarning,
  AntigravityCliStatusDto,
} from '@/shared/contracts';

const MAX_STDOUT_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;
const MAX_EVENT_BYTES = 1024 * 1024;
const MINIMUM_STRUCTURED_OUTPUT_VERSION = [1, 1, 8] as const;

const terminalStatusSchema = z.enum(['SUCCESS', 'ERROR', 'CANCELED', 'INTERRUPTED', 'INVALID', 'WAITING', 'RUNNING']);
const usageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    thinking_tokens: z.number().int().nonnegative(),
    cache_read_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  })
  .strict();

const printEnvelopeSchema = z
  .object({
    conversation_id: z.string().max(500),
    status: terminalStatusSchema,
    response: z.string().max(MAX_STDOUT_BYTES),
    error: z.string().max(100_000).optional(),
    duration_seconds: z.number().nonnegative(),
    num_turns: z.number().int().nonnegative(),
    usage: usageSchema,
    structured_output: z.unknown().optional(),
    command: z.unknown().optional(),
  })
  .passthrough();

const usageCommandDataSchema = z
  .object({
    description: z.string().max(20_000).optional().default(''),
    groups: z
      .array(
        z
          .object({
            name: z.string().min(1).max(500),
            description: z.string().max(5_000).optional().default(''),
            buckets: z
              .array(
                z
                  .object({
                    id: z.string().min(1).max(500),
                    name: z.string().min(1).max(500),
                    window: z.string().min(1).max(100),
                    remaining_fraction: z.number().min(0).max(1),
                    reset_time: z.string().max(100).optional(),
                  })
                  .strict(),
              )
              .max(100),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

const usageCommandSchema = z.object({ name: z.literal('usage'), data: usageCommandDataSchema }).strict();

const modelCommandSchema = z
  .object({
    name: z.literal('model'),
    data: z
      .object({
        id: z.string().min(1).max(200),
        label: z.string().min(1).max(500),
        effort: z.string().max(100).optional(),
        is_default: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

const streamEventSchema = z
  .object({
    event: z.enum(['init', 'step_update', 'result']),
    init: z.unknown().optional(),
    step_update: z.unknown().optional(),
    result: z.unknown().optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (value[value.event] === undefined) {
      context.addIssue({ code: 'custom', message: `Missing ${value.event} payload` });
    }
  });

export type AntigravityPrintEnvelope = z.infer<typeof printEnvelopeSchema>;
export type AntigravityStreamEvent = z.infer<typeof streamEventSchema>;

interface ProcessResult {
  stdout: string;
  stderr: string;
}

interface ProcessOptions {
  cwd: string;
  timeoutMs: number;
  signal?: AbortSignal;
  input?: string;
  onStdoutLine?(line: string): void;
}

export class AntigravityCliProcessError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = 'AntigravityCliProcessError';
  }
}

function cancelledError() {
  return Object.assign(new Error('Antigravity CLI request was cancelled'), { code: 'CANCELLED' as const });
}

function resolveAntigravityBinary() {
  const configured = process.env.ANTIGRAVITY_BINARY?.trim();
  if (configured) return configured;
  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (process.platform === 'win32' && localAppData) {
    const installed = path.join(localAppData, 'agy', 'bin', 'agy.exe');
    if (existsSync(installed)) return installed;
  }
  return 'agy';
}

function childEnvironment() {
  const environment: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  // Gemini API credentials belong to the separate AI Studio connection. The
  // CLI route intentionally uses the user's Antigravity sign-in and quota.
  delete environment.GEMINI_API_KEY;
  delete environment.GOOGLE_API_KEY;
  delete environment.GOOGLE_GENAI_API_KEY;
  delete environment.GOOGLE_GEMINI_BASE_URL;
  return environment;
}

function runProcess(binary: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
  if (options.signal?.aborted) return Promise.reject(cancelledError());
  return new Promise((resolve, reject) => {
    const child: ChildProcessWithoutNullStreams = spawn(binary, args, {
      cwd: options.cwd,
      env: childEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let lineBuffer = '';
    let callbackError: unknown = null;
    let outputOverflow = false;
    let timedOut = false;
    let cancelled = false;
    let settled = false;
    const decoder = new StringDecoder('utf8');
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      operation();
    };
    const onAbort = () => {
      cancelled = true;
      child.kill();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();

    const emitLines = (text: string, flush: boolean) => {
      if (!options.onStdoutLine || callbackError) return;
      lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() ?? '';
      if (flush && lineBuffer) {
        lines.push(lineBuffer);
        lineBuffer = '';
      }
      try {
        for (const line of lines) {
          if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_BYTES) throw new Error('Antigravity event is too large');
          if (line.trim()) options.onStdoutLine(line);
        }
      } catch (error) {
        callbackError = error;
        child.kill();
      }
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        outputOverflow = true;
        child.kill();
        return;
      }
      const text = decoder.write(chunk);
      stdout += text;
      emitLines(text, false);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_STDERR_BYTES) {
        outputOverflow = true;
        child.kill();
        return;
      }
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => finish(() => reject(cancelled ? cancelledError() : error)));
    child.on('close', (code, signal) => {
      const tail = decoder.end();
      stdout += tail;
      emitLines(tail, true);
      finish(() => {
        if (cancelled) return reject(cancelledError());
        if (callbackError) return reject(callbackError);
        if (outputOverflow) {
          return reject(
            new AntigravityCliProcessError('Antigravity CLI output exceeded its limit', stdout, stderr, code),
          );
        }
        if (timedOut) {
          return reject(new AntigravityCliProcessError('Antigravity CLI timed out', stdout, stderr, code));
        }
        if (code === 0) return resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        const detail = stderr.trim().slice(-1_000);
        return reject(
          new AntigravityCliProcessError(
            `Antigravity CLI ${signal ? `was terminated by ${signal}` : `exited with ${code}`}${detail ? `: ${detail}` : ''}`,
            stdout,
            stderr,
            code,
          ),
        );
      });
    });
    child.stdin.end(options.input ?? '', 'utf8');
  });
}

function parseJson(value: string, description: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Antigravity CLI returned malformed ${description}`, { cause: error });
  }
}

function parseVersion(value: string) {
  const match = /(?:^|\s)(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(value.trim());
  if (!match) throw new Error('Antigravity CLI returned an invalid version');
  return { text: `${match[1]}.${match[2]}.${match[3]}`, parts: [Number(match[1]), Number(match[2]), Number(match[3])] };
}

function versionAtLeast(actual: readonly number[], required: readonly number[]) {
  for (let index = 0; index < required.length; index += 1) {
    if ((actual[index] ?? 0) > (required[index] ?? 0)) return true;
    if ((actual[index] ?? 0) < (required[index] ?? 0)) return false;
  }
  return true;
}

function parseModels(value: string): AntigravityCliModelDto[] {
  const models: AntigravityCliModelDto[] = [];
  const seen = new Set<string>();
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line === 'Fetching available models...') continue;
    const separator = line.indexOf('\t');
    if (separator <= 0) throw new Error('Antigravity CLI returned an invalid model catalog');
    const key = line.slice(0, separator).trim();
    const name = line.slice(separator + 1).trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(key) || !name || name.length > 500 || seen.has(key)) {
      throw new Error('Antigravity CLI returned an invalid model catalog');
    }
    seen.add(key);
    models.push({ key, name, isCurrent: false });
    if (models.length > 100) throw new Error('Antigravity CLI returned too many models');
  }
  if (!models.length) throw new Error('Antigravity CLI returned no available models');
  return models;
}

function warningForGroups(groups: readonly AntigravityCliQuotaGroupDto[]): AntigravityCliQuotaWarning {
  const remaining = groups.flatMap((group) => group.buckets.map((bucket) => bucket.remainingFraction));
  if (!remaining.length) return 'UNAVAILABLE';
  if (remaining.some((value) => value <= 0)) return 'EXHAUSTED';
  if (remaining.some((value) => value <= 0.2)) return 'LOW';
  return 'NONE';
}

function unavailableQuota(message = 'Quota is unavailable'): AntigravityCliQuotaDto {
  return { warning: 'UNAVAILABLE', groups: [], checkedAt: null, message };
}

function initialStatus(): AntigravityCliStatusDto {
  return {
    state: 'checking',
    version: '',
    authenticated: false,
    message: 'Checking local Antigravity CLI',
    currentModel: null,
    models: [],
    quota: unavailableQuota(),
  };
}

function cloneStatus(status: AntigravityCliStatusDto): AntigravityCliStatusDto {
  return {
    ...status,
    currentModel: status.currentModel ? { ...status.currentModel } : null,
    models: status.models.map((model) => ({ ...model })),
    quota: {
      ...status.quota,
      groups: status.quota.groups.map((group) => ({
        ...group,
        buckets: group.buckets.map((bucket) => ({ ...bucket })),
      })),
    },
  };
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).trim().slice(0, 1_000);
}

export class AntigravityCliRuntime {
  readonly binary: string;
  private currentStatus = initialStatus();

  constructor(binary = resolveAntigravityBinary()) {
    this.binary = binary;
  }

  get status() {
    return cloneStatus(this.currentStatus);
  }

  async refresh(signal?: AbortSignal): Promise<AntigravityCliStatusDto> {
    this.currentStatus = { ...this.currentStatus, state: 'checking', message: 'Checking local Antigravity CLI' };
    try {
      const cwd = process.cwd();
      const [versionResult, modelsResult] = await Promise.all([
        runProcess(this.binary, ['--version'], { cwd, timeoutMs: 10_000, signal }),
        runProcess(this.binary, ['models'], { cwd, timeoutMs: 30_000, signal }),
      ]);
      const version = parseVersion(versionResult.stdout);
      if (!versionAtLeast(version.parts, MINIMUM_STRUCTURED_OUTPUT_VERSION)) {
        throw new Error(`Antigravity CLI ${version.text} is unsupported; version 1.1.8 or newer is required`);
      }
      let models = parseModels(modelsResult.stdout);
      const [modelResult, quotaResult] = await Promise.allSettled([
        this.readCommand('/model', cwd, signal),
        this.readCommand('/usage', cwd, signal),
      ]);
      if (modelResult.status === 'rejected' && quotaResult.status === 'rejected') {
        throw new Error(`Antigravity sign-in check failed: ${errorMessage(modelResult.reason)}`);
      }

      let currentModel: AntigravityCliModelDto | null = null;
      if (modelResult.status === 'fulfilled') {
        const command = modelCommandSchema.parse(modelResult.value.command);
        currentModel = { key: command.data.id, name: command.data.label, isCurrent: true };
        models = models.map((model) => ({ ...model, isCurrent: model.key === currentModel!.key }));
        if (!models.some((model) => model.key === currentModel!.key)) models.unshift(currentModel);
      }

      let quota: AntigravityCliQuotaDto;
      if (quotaResult.status === 'fulfilled') {
        const command = usageCommandSchema.parse(quotaResult.value.command);
        const groups: AntigravityCliQuotaGroupDto[] = command.data.groups.map((group) => ({
          name: group.name,
          description: group.description,
          buckets: group.buckets.map((bucket) => ({
            id: bucket.id,
            name: bucket.name,
            window: bucket.window,
            remainingFraction: bucket.remaining_fraction,
            resetAt: bucket.reset_time ?? null,
          })),
        }));
        quota = {
          warning: warningForGroups(groups),
          groups,
          checkedAt: new Date().toISOString(),
          message: command.data.description,
        };
      } else {
        quota = unavailableQuota(errorMessage(quotaResult.reason));
      }

      this.currentStatus = {
        state: 'ready',
        version: version.text,
        authenticated: true,
        message: 'Local Antigravity CLI ready',
        currentModel,
        models,
        quota,
      };
    } catch (error) {
      if (signal?.aborted) throw cancelledError();
      this.currentStatus = {
        ...initialStatus(),
        state: 'unavailable',
        message: errorMessage(error) || 'Local Antigravity CLI is unavailable',
      };
    }
    return this.status;
  }

  async ensureReady(signal?: AbortSignal) {
    if (this.currentStatus.state !== 'ready') await this.refresh(signal);
    if (this.currentStatus.state !== 'ready') throw new Error(this.currentStatus.message);
    return this.status;
  }

  async runPrintJson(options: {
    cwd: string;
    prompt: string;
    timeoutMs: number;
    signal?: AbortSignal;
    model?: string | null;
    jsonSchemaPath?: string;
    mode?: 'plan' | 'accept-edits';
  }): Promise<AntigravityPrintEnvelope> {
    await this.ensureReady(options.signal);
    const result = await runProcess(this.binary, this.printArguments(options, 'json'), {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
    const envelope = printEnvelopeSchema.parse(parseJson(result.stdout, 'JSON output'));
    this.assertSuccessful(envelope);
    return envelope;
  }

  async runPrintStream(options: {
    cwd: string;
    prompt: string;
    timeoutMs: number;
    signal?: AbortSignal;
    model?: string | null;
    mode?: 'plan' | 'accept-edits';
    onEvent(event: AntigravityStreamEvent): void;
  }): Promise<AntigravityPrintEnvelope> {
    await this.ensureReady(options.signal);
    let terminal: AntigravityPrintEnvelope | null = null;
    await runProcess(this.binary, this.printArguments(options, 'stream-json'), {
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      onStdoutLine: (line) => {
        const event = streamEventSchema.parse(parseJson(line, 'stream event'));
        options.onEvent(event);
        if (event.event === 'result') terminal = printEnvelopeSchema.parse(event.result);
      },
    });
    if (!terminal) throw new Error('Antigravity CLI stream ended without a result event');
    this.assertSuccessful(terminal);
    return terminal;
  }

  private async readCommand(command: '/model' | '/usage', cwd: string, signal?: AbortSignal) {
    const result = await runProcess(this.binary, ['-p', command, '--output-format', 'json', '--print-timeout', '30s'], {
      cwd,
      timeoutMs: 35_000,
      signal,
    });
    const envelope = printEnvelopeSchema.parse(parseJson(result.stdout, `${command} output`));
    this.assertSuccessful(envelope);
    return envelope;
  }

  private printArguments(
    options: {
      prompt: string;
      timeoutMs: number;
      model?: string | null;
      jsonSchemaPath?: string;
      mode?: 'plan' | 'accept-edits';
    },
    outputFormat: 'json' | 'stream-json',
  ) {
    const model = options.model?.trim();
    if (model && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(model)) {
      throw new Error('Invalid Antigravity model selection');
    }
    return [
      '-p',
      options.prompt,
      '--output-format',
      outputFormat,
      '--print-timeout',
      `${Math.max(1, Math.ceil(options.timeoutMs / 1_000))}s`,
      '--sandbox',
      ...(options.mode ? ['--mode', options.mode] : []),
      ...(model ? ['--model', model] : []),
      ...(options.jsonSchemaPath ? ['--json-schema', options.jsonSchemaPath] : []),
    ];
  }

  private assertSuccessful(envelope: AntigravityPrintEnvelope) {
    if (envelope.status === 'SUCCESS') return;
    const detail = envelope.error?.trim() || envelope.response.trim() || envelope.status;
    throw new Error(`Antigravity CLI request failed: ${detail.slice(0, 1_000)}`);
  }
}
