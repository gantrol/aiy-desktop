import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { z } from 'zod';
import {
  CodexAppServerCaptureError,
  CodexAppServerEmptyResponseError,
  CodexAppServerRpcError,
} from '@/main/extensions/codex-app-server/errors';
import {
  CODEX_APP_SERVER_MAX_MESSAGE_BYTES,
  accountReadResponseSchema,
  agentMessageCompletedItemSchema,
  codexReasoningEffortSchema,
  imageGenerationCompletedItemSchema,
  itemCompletedNotificationSchema,
  mergeCodexAppServerRateLimits,
  modelCatalogResponseSchema,
  rateLimitsReadResponseSchema,
  rateLimitsUpdatedNotificationSchema,
  turnCompletedNotificationSchema,
  type CodexAppServerAccountReadResult,
  type CodexAppServerModelCatalogEntry,
  type CodexAppServerRateLimits,
  type CodexAppServerReadiness,
} from '@/main/extensions/codex-app-server/protocol';
import {
  preflightCodexAppServer,
  type CodexAppServerModelCatalogResult,
  type CodexAppServerPreflightInput,
} from '@/main/extensions/codex-app-server/readiness';
import {
  isCriticalEarlyTurnMessage,
  normalizedTurnEvent,
  type CodexAppServerTurnEvent,
} from '@/main/extensions/codex-app-server/turn-events';
import { CodexTurnTimeouts, codexTurnTimeoutError } from '@/main/extensions/codex-app-server/turn-timeouts';
import type { AssistantReasoningEffort, CodexTextModelDto } from '@/shared/contracts';

export type { CodexAppServerTurnEvent } from '@/main/extensions/codex-app-server/turn-events';
export {
  CodexAppServerCaptureError,
  CodexAppServerEmptyResponseError,
  CodexAppServerRpcError,
} from '@/main/extensions/codex-app-server/errors';
export type { CodexAppServerPreflightInput } from '@/main/extensions/codex-app-server/readiness';
export type {
  CodexAppServerReadiness,
  CodexAppServerReadinessDiagnostic,
  CodexAppServerReadinessStatus,
} from '@/main/extensions/codex-app-server/protocol';

type RequestId = number | string;
type JsonObject = Record<string, unknown>;

const requestIdSchema = z.union([z.number().int(), z.string().max(512)]);
const rpcMessageSchema = z
  .object({
    id: requestIdSchema.optional(),
    method: z.string().max(1_000).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    result: z.unknown().optional(),
    error: z
      .object({
        code: z.number().int().optional(),
        message: z.string().max(100_000).optional(),
        data: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

type RpcMessage = z.infer<typeof rpcMessageSchema>;

const threadResponseSchema = z
  .object({
    thread: z.object({ id: z.string().min(1).max(512), sessionId: z.string().max(512).optional() }).passthrough(),
  })
  .passthrough();

const turnResponseSchema = z.object({ turn: z.object({ id: z.string().min(1).max(512) }).passthrough() }).passthrough();

const ignoredResponseSchema = z.record(z.string(), z.unknown());

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CodexAppServerImageResult {
  savedPath: string | null;
  revisedPrompt: string | null;
  result: string;
}

export interface CodexAppServerTurnResult {
  threadId: string;
  turnId: string;
  status: 'completed';
  finalMessage: string;
  image: CodexAppServerImageResult | null;
  usage: NonNullable<CodexAppServerTurnEvent['usage']> | null;
}

interface TurnTracker {
  threadId: string;
  turnId: string;
  finalMessage: string;
  image: CodexAppServerImageResult | null;
  usage: NonNullable<CodexAppServerTurnEvent['usage']> | null;
  onEvent?: (event: CodexAppServerTurnEvent) => void;
  resolve(value: CodexAppServerTurnResult): void;
  reject(reason: Error): void;
  timeouts: CodexTurnTimeouts;
}

interface BufferedTurnMessage {
  message: RpcMessage;
  byteSize: number;
  critical: boolean;
}

export interface StartThreadInput {
  cwd: string;
  developerInstructions: string;
  webSearchMode?: 'disabled' | 'live';
  ephemeral?: boolean;
}

export interface StartTurnInput {
  threadId: string;
  cwd: string;
  text: string;
  model?: string;
  effort?: AssistantReasoningEffort;
  localImages?: string[];
  outputSchema?: JsonObject;
  /** Absolute provider turn limit. */
  timeoutMs: number;
  /** Optional maximum interval without a turn event. Active turns renew this timer. */
  idleTimeoutMs?: number;
  onStarted?(cancel: () => void, turnId: string): void;
  onEvent?(event: CodexAppServerTurnEvent): void;
}

const MAX_LINE_BYTES = CODEX_APP_SERVER_MAX_MESSAGE_BYTES;
const MAX_EARLY_TURN_MESSAGES = 100;
const MAX_EARLY_TURN_BYTES = MAX_LINE_BYTES + 256 * 1024;
const MAX_EARLY_GLOBAL_BYTES = 32 * 1024 * 1024;
const MAX_EARLY_TURNS = 64;

function reasoningEffort(value: unknown): AssistantReasoningEffort | null {
  const parsed = codexReasoningEffortSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseRpcMessage(line: string) {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    throw new Error('Codex App Server sent malformed JSON');
  }
  const parsed = rpcMessageSchema.safeParse(value);
  if (!parsed.success) throw new Error('Codex App Server sent an invalid RPC message');
  return parsed.data;
}

function threadConfiguration(input: Pick<StartThreadInput, 'webSearchMode'>): JsonObject {
  return input.webSearchMode ? { config: { web_search: input.webSearchMode } } : {};
}

/** One JSONL app-server connection shared by the detached model worker. */
export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private requestSequence = 0;
  private stderrTail = '';
  private disposed = false;
  private readonly requests = new Map<RequestId, PendingRequest>();
  private readonly turns = new Map<string, TurnTracker>();
  private readonly earlyTurnMessages = new Map<string, BufferedTurnMessage[]>();
  private readonly earlyTurnDroppedMessages = new Map<string, { count: number; exact: boolean }>();
  private readonly earlyTurnBytes = new Map<string, number>();
  private earlyTurnBufferedBytes = 0;
  private rateLimitsCache: CodexAppServerRateLimits | null = null;
  private rateLimitsNotificationValidationFailed = false;

  constructor(
    private readonly binary: string,
    private readonly defaultCwd: string,
  ) {}

  async startThread(input: StartThreadInput) {
    return this.request(
      'thread/start',
      {
        cwd: input.cwd,
        approvalPolicy: 'never',
        sandbox: 'workspace-write',
        serviceName: 'aiy_beauty_dictionary',
        developerInstructions: input.developerInstructions,
        ...threadConfiguration(input),
        ephemeral: input.ephemeral ?? false,
        threadSource: 'aiy_beauty_dictionary',
      },
      threadResponseSchema,
      30_000,
    );
  }

  async resumeThread(threadId: string, cwd: string, webSearchMode?: StartThreadInput['webSearchMode']) {
    return this.request(
      'thread/resume',
      {
        threadId,
        cwd,
        approvalPolicy: 'never',
        sandbox: 'workspace-write',
        ...threadConfiguration({ webSearchMode }),
      },
      threadResponseSchema,
      30_000,
    );
  }

  async forkThread(threadId: string, input: StartThreadInput) {
    return this.request(
      'thread/fork',
      {
        threadId,
        cwd: input.cwd,
        approvalPolicy: 'never',
        sandbox: 'workspace-write',
        developerInstructions: input.developerInstructions,
        ...threadConfiguration(input),
        ephemeral: input.ephemeral ?? false,
        threadSource: 'aiy_beauty_dictionary',
      },
      threadResponseSchema,
      30_000,
    );
  }

  async setThreadName(threadId: string, name: string) {
    await this.request('thread/name/set', { threadId, name }, ignoredResponseSchema, 15_000);
  }

  async readAccount(): Promise<CodexAppServerAccountReadResult> {
    return this.request('account/read', { refreshToken: false }, accountReadResponseSchema, 30_000);
  }

  async readRateLimits(): Promise<CodexAppServerRateLimits> {
    const result = await this.request('account/rateLimits/read', undefined, rateLimitsReadResponseSchema, 30_000);
    this.rateLimitsCache = result;
    this.rateLimitsNotificationValidationFailed = false;
    return result;
  }

  getCachedRateLimits(): CodexAppServerRateLimits | null {
    if (!this.rateLimitsCache) return null;
    const parsed = rateLimitsReadResponseSchema.safeParse(this.rateLimitsCache);
    if (!parsed.success) {
      this.rateLimitsCache = null;
      return null;
    }
    return parsed.data;
  }

  async listModels(): Promise<CodexTextModelDto[]> {
    const catalog = await this.readModelCatalog(false);
    const models = new Map<string, CodexTextModelDto>();
    for (const raw of catalog.entries) {
      const key = raw.model?.trim() || raw.id?.trim() || '';
      if (!key || key.length > 200) continue;
      if (raw.inputModalities && !raw.inputModalities.includes('text')) continue;
      const supportedReasoningEfforts = raw.supportedReasoningEfforts
        ? raw.supportedReasoningEfforts.flatMap((entry) => {
            const effort = reasoningEffort(entry.reasoningEffort);
            return effort ? [effort] : [];
          })
        : [];
      models.set(key, {
        key,
        name: raw.displayName?.trim() ? raw.displayName.trim() : key,
        isDefault: raw.isDefault === true,
        defaultReasoningEffort: reasoningEffort(raw.defaultReasoningEffort),
        supportedReasoningEfforts: [...new Set(supportedReasoningEfforts)],
      });
    }
    return [...models.values()];
  }

  async preflight(input: CodexAppServerPreflightInput): Promise<CodexAppServerReadiness> {
    return preflightCodexAppServer(input, {
      readAccount: () => this.readAccount(),
      readModelCatalog: () => this.readModelCatalog(true),
      readRateLimits: () => this.readRateLimits(),
      getCachedRateLimits: () => this.getCachedRateLimits(),
      hasInvalidRateLimitsNotification: () => this.rateLimitsNotificationValidationFailed,
    });
  }

  private async readModelCatalog(includeHidden: boolean): Promise<CodexAppServerModelCatalogResult> {
    const models = new Map<string, CodexAppServerModelCatalogEntry>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;
    let complete = false;
    for (let page = 0; page < 20; page += 1) {
      const response = await this.request(
        'model/list',
        { limit: 100, includeHidden, ...(cursor ? { cursor } : {}) },
        modelCatalogResponseSchema,
        30_000,
      );
      for (const raw of response.data) {
        const key = `${raw.model ?? ''}\u0000${raw.id ?? ''}`;
        models.set(key, raw);
      }
      const nextCursor = response.nextCursor?.trim() || undefined;
      if (!nextCursor) {
        complete = true;
        break;
      }
      if (nextCursor === cursor || seenCursors.has(nextCursor)) break;
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    return { entries: [...models.values()], complete };
  }

  async runTurn(input: StartTurnInput): Promise<CodexAppServerTurnResult> {
    const userInput: JsonObject[] = [
      { type: 'text', text: input.text, text_elements: [] },
      ...(input.localImages ?? []).map((imagePath) => ({ type: 'localImage', path: imagePath })),
    ];
    const response = await this.request(
      'turn/start',
      {
        threadId: input.threadId,
        input: userInput,
        cwd: input.cwd,
        ...(input.model ? { model: input.model } : {}),
        ...(input.effort ? { effort: input.effort } : {}),
        approvalPolicy: 'never',
        sandboxPolicy: {
          type: 'workspaceWrite',
          writableRoots: [input.cwd],
          networkAccess: true,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
        ...(input.outputSchema ? { outputSchema: input.outputSchema } : {}),
      },
      turnResponseSchema,
      30_000,
    );
    const turnId = response.turn.id;
    return new Promise<CodexAppServerTurnResult>((resolve, reject) => {
      const timeouts = new CodexTurnTimeouts(input.timeoutMs, input.idleTimeoutMs ?? null, (kind) => {
        if (this.turns.get(turnId) !== tracker) return;
        this.turns.delete(turnId);
        void this.interruptTurn(input.threadId, turnId);
        reject(codexTurnTimeoutError(kind));
      });
      const tracker: TurnTracker = {
        threadId: input.threadId,
        turnId,
        finalMessage: '',
        image: null,
        usage: null,
        onEvent: input.onEvent,
        resolve,
        reject,
        timeouts,
      };
      this.turns.set(turnId, tracker);
      tracker.timeouts.start();
      const cancel = () => {
        void this.interruptTurn(input.threadId, turnId);
      };
      try {
        input.onStarted?.(cancel, turnId);
      } catch {
        // A host observer is auxiliary and must not terminate the provider turn.
      }
      const droppedEarlyMessages = this.earlyTurnDroppedMessages.get(turnId);
      if (droppedEarlyMessages && droppedEarlyMessages.count > 0) {
        this.emitTurnEvent(tracker, {
          method: 'capture/degraded',
          itemStatus: 'degraded',
          degradationReason: 'EARLY_EVENT_BUFFER_LIMIT',
          droppedEventCount: droppedEarlyMessages.count,
          droppedEventCountExact: droppedEarlyMessages.exact,
        });
      }
      const bufferedMessages = this.earlyTurnMessages.get(turnId) ?? [];
      try {
        for (const entry of bufferedMessages) this.routeTurnMessage(entry.message, tracker);
      } finally {
        this.releaseEarlyTurnBuffer(turnId);
      }
    });
  }

  async interruptTurn(threadId: string, turnId: string) {
    try {
      await this.request('turn/interrupt', { threadId, turnId }, ignoredResponseSchema, 15_000);
    } catch {
      // Completion, disconnect, or a concurrent cancellation can win the race.
    }
  }

  async dispose() {
    if (this.disposed) return;
    const active = [...this.turns.values()];
    await Promise.all(active.map((turn) => this.interruptTurn(turn.threadId, turn.turnId)));
    this.disposed = true;
    const child = this.child;
    this.failConnection(new Error('Codex App Server connection closed'));
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000);
      timer.unref();
      child.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  }

  private async request<T>(
    method: string,
    params: JsonObject | undefined,
    schema: z.ZodType<T>,
    timeoutMs: number,
  ): Promise<T> {
    await this.ensureStarted();
    return this.sendRequest(method, params, schema, timeoutMs);
  }

  private async ensureStarted() {
    if (this.disposed) throw new Error('Codex App Server client is closed');
    if (this.child && !this.child.killed) return;
    if (this.starting) return this.starting;
    this.starting = this.start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async start() {
    const environment: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
    // The Codex plugin uses the user's Codex sign-in. API credentials belong to
    // the separate OpenAI Image API plugin and must not silently change billing.
    delete environment.OPENAI_API_KEY;
    delete environment.CODEX_API_KEY;
    delete environment.CODEX_ACCESS_TOKEN;
    const child = spawn(this.binary, ['app-server', '--listen', 'stdio://'], {
      cwd: this.defaultCwd,
      env: environment,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.stderrTail = '';
    child.stderr.on('data', (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString('utf8')}`.slice(-8_000);
    });
    child.once('error', (error) => this.failConnection(error));
    child.once('close', (code, signal) => {
      const detail = this.stderrTail.trim();
      this.failConnection(
        new Error(
          `Codex App Server ${signal ? `was terminated by ${signal}` : `exited with ${code}`}${detail ? `: ${detail}` : ''}`,
        ),
      );
    });
    let pendingLineChunks: Buffer[] = [];
    let pendingLineBytes = 0;
    let framingFailed = false;
    const failFraming = (error: Error) => {
      if (framingFailed) return;
      framingFailed = true;
      pendingLineChunks = [];
      pendingLineBytes = 0;
      this.failConnection(error);
      child.kill();
    };
    const processLine = (lastSegment: Buffer) => {
      const byteSize = pendingLineBytes + lastSegment.byteLength;
      let bytes = pendingLineChunks.length ? Buffer.concat([...pendingLineChunks, lastSegment], byteSize) : lastSegment;
      pendingLineChunks = [];
      pendingLineBytes = 0;
      if (bytes.at(-1) === 0x0d) bytes = bytes.subarray(0, -1);
      if (bytes.byteLength === 0) return;
      let message: RpcMessage;
      try {
        message = parseRpcMessage(bytes.toString('utf8'));
      } catch {
        failFraming(new CodexAppServerCaptureError('INVALID_RPC_MESSAGE', 1, false));
        return;
      }
      try {
        this.handleMessage(message);
      } catch (error) {
        failFraming(error instanceof Error ? error : new Error(String(error)));
      }
    };
    child.stdout.on('data', (rawChunk: Buffer | string) => {
      if (framingFailed) return;
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk, 'utf8');
      let offset = 0;
      while (offset < chunk.byteLength) {
        const newline = chunk.indexOf(0x0a, offset);
        const end = newline < 0 ? chunk.byteLength : newline;
        const segment = chunk.subarray(offset, end);
        if (pendingLineBytes + segment.byteLength > MAX_LINE_BYTES) {
          failFraming(new CodexAppServerCaptureError('RPC_MESSAGE_SIZE_LIMIT', 1, false));
          return;
        }
        if (newline < 0) {
          if (segment.byteLength > 0) {
            pendingLineChunks.push(segment);
            pendingLineBytes += segment.byteLength;
          }
          return;
        }
        processLine(segment);
        if (framingFailed) return;
        offset = newline + 1;
      }
    });
    child.stdout.once('end', () => {
      if (framingFailed || pendingLineBytes === 0) return;
      processLine(Buffer.alloc(0));
    });
    try {
      await this.sendRequest(
        'initialize',
        {
          clientInfo: {
            name: 'aiy_beauty_dictionary',
            title: 'AIY Beauty Dictionary',
            version: '0.3.0',
          },
          capabilities: {
            experimentalApi: false,
            requestAttestation: false,
          },
        },
        ignoredResponseSchema,
        20_000,
      );
      this.send({ method: 'initialized', params: {} });
    } catch (error) {
      child.kill();
      if (this.child === child) this.child = null;
      throw error;
    }
  }

  private sendRequest<T>(
    method: string,
    params: JsonObject | undefined,
    schema: z.ZodType<T>,
    timeoutMs: number,
  ): Promise<T> {
    const id = ++this.requestSequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.requests.delete(id);
        reject(new Error(`Codex App Server request timed out: ${method}`));
      }, timeoutMs);
      this.requests.set(id, {
        resolve: (value) => {
          const decoded = schema.safeParse(value);
          if (!decoded.success) {
            reject(new Error(`Codex App Server returned an invalid result for ${method}`));
            return;
          }
          resolve(decoded.data);
        },
        reject,
        timer,
      });
      try {
        this.send({ method, id, ...(params === undefined ? {} : { params }) });
      } catch (error) {
        clearTimeout(timer);
        this.requests.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private send(message: RpcMessage) {
    const child = this.child;
    if (!child || child.killed || !child.stdin.writable) throw new Error('Codex App Server is disconnected');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleMessage(message: RpcMessage) {
    if (message.id === undefined && message.method === 'account/rateLimits/updated') {
      const parsed = rateLimitsUpdatedNotificationSchema.safeParse(message.params);
      if (!parsed.success) {
        this.rateLimitsNotificationValidationFailed = true;
        return;
      }
      this.rateLimitsCache = mergeCodexAppServerRateLimits(this.rateLimitsCache, parsed.data);
      this.rateLimitsNotificationValidationFailed = false;
      return;
    }
    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }
    if (message.id !== undefined) {
      const request = this.requests.get(message.id);
      if (!request) return;
      clearTimeout(request.timer);
      this.requests.delete(message.id);
      if (message.error) {
        request.reject(
          new CodexAppServerRpcError(
            message.error.message || 'Codex App Server request failed',
            message.error.code,
            message.error.data,
          ),
        );
      } else {
        request.resolve(message.result);
      }
      return;
    }
    const turnId =
      typeof message.params?.turnId === 'string' ? message.params.turnId : this.turnIdFromCompleted(message);
    if (!turnId) return;
    const tracker = this.turns.get(turnId);
    if (tracker) {
      this.routeTurnMessage(message, tracker);
      return;
    }
    this.bufferEarlyTurnMessage(turnId, message);
  }

  private bufferEarlyTurnMessage(turnId: string, message: RpcMessage) {
    let buffered = this.earlyTurnMessages.get(turnId);
    if (!buffered) {
      if (this.earlyTurnMessages.size >= MAX_EARLY_TURNS) {
        throw new CodexAppServerCaptureError('EARLY_TURN_COUNT_LIMIT', 1, false);
      }
      buffered = [];
      this.earlyTurnMessages.set(turnId, buffered);
      this.earlyTurnBytes.set(turnId, 0);
    }
    const encoded = JSON.stringify(message);
    if (!encoded) throw new CodexAppServerCaptureError('EARLY_EVENT_ENCODING_FAILED', 1, false);
    const byteSize = Buffer.byteLength(encoded, 'utf8');
    const critical = isCriticalEarlyTurnMessage(message);
    const exceedsLocalLimit = () =>
      buffered.length >= MAX_EARLY_TURN_MESSAGES ||
      (this.earlyTurnBytes.get(turnId) ?? 0) + byteSize > MAX_EARLY_TURN_BYTES;
    if (!critical) {
      if (exceedsLocalLimit() || this.earlyTurnBufferedBytes + byteSize > MAX_EARLY_GLOBAL_BYTES) {
        this.markEarlyTurnDropped(turnId);
        return;
      }
    } else {
      while (exceedsLocalLimit()) {
        const replaceIndex = buffered.findIndex((entry) => !entry.critical);
        if (replaceIndex < 0) {
          throw new CodexAppServerCaptureError('EARLY_CRITICAL_EVENT_CAPACITY_LIMIT', 1, false);
        }
        this.removeEarlyTurnEntry(turnId, replaceIndex, true);
      }
      while (this.earlyTurnBufferedBytes + byteSize > MAX_EARLY_GLOBAL_BYTES) {
        if (!this.evictOneEarlyNonCriticalMessage()) {
          throw new CodexAppServerCaptureError('EARLY_GLOBAL_BYTE_LIMIT', 1, false);
        }
      }
    }
    buffered.push({ message, byteSize, critical });
    this.earlyTurnBytes.set(turnId, (this.earlyTurnBytes.get(turnId) ?? 0) + byteSize);
    this.earlyTurnBufferedBytes += byteSize;
  }

  private evictOneEarlyNonCriticalMessage() {
    for (const [turnId, buffered] of this.earlyTurnMessages) {
      const index = buffered.findIndex((entry) => !entry.critical);
      if (index < 0) continue;
      this.removeEarlyTurnEntry(turnId, index, true);
      return true;
    }
    return false;
  }

  private removeEarlyTurnEntry(turnId: string, index: number, dropped: boolean) {
    const buffered = this.earlyTurnMessages.get(turnId);
    const [removed] = buffered?.splice(index, 1) ?? [];
    if (!removed) return;
    const nextTurnBytes = Math.max(0, (this.earlyTurnBytes.get(turnId) ?? 0) - removed.byteSize);
    this.earlyTurnBytes.set(turnId, nextTurnBytes);
    this.earlyTurnBufferedBytes = Math.max(0, this.earlyTurnBufferedBytes - removed.byteSize);
    if (dropped) this.markEarlyTurnDropped(turnId);
  }

  private markEarlyTurnDropped(turnId: string) {
    const dropped = this.earlyTurnDroppedMessages.get(turnId) ?? { count: 0, exact: true };
    this.earlyTurnDroppedMessages.set(
      turnId,
      dropped.count < Number.MAX_SAFE_INTEGER
        ? { count: dropped.count + 1, exact: dropped.exact }
        : { count: dropped.count, exact: false },
    );
  }

  private releaseEarlyTurnBuffer(turnId: string) {
    this.earlyTurnBufferedBytes = Math.max(0, this.earlyTurnBufferedBytes - (this.earlyTurnBytes.get(turnId) ?? 0));
    this.earlyTurnMessages.delete(turnId);
    this.earlyTurnBytes.delete(turnId);
    this.earlyTurnDroppedMessages.delete(turnId);
  }

  private handleServerRequest(message: RpcMessage) {
    const id = message.id!;
    if (
      message.method === 'item/commandExecution/requestApproval' ||
      message.method === 'item/fileChange/requestApproval'
    ) {
      this.send({ id, result: { decision: 'decline' } });
      return;
    }
    if (message.method === 'item/tool/requestUserInput') {
      this.send({ id, result: { answers: {} } });
      return;
    }
    if (message.method === 'mcpServer/elicitation/request') {
      this.send({ id, result: { action: 'decline', content: null, _meta: null } });
      return;
    }
    this.send({
      id,
      error: { code: -32601, message: `Host does not grant server request: ${message.method}` },
    });
  }

  private routeTurnMessage(message: RpcMessage, tracker: TurnTracker) {
    tracker.timeouts.renewActivity();
    const method = message.method ?? '';
    const event = normalizedTurnEvent(message);
    if (event.usage) tracker.usage = event.usage;
    this.emitTurnEvent(tracker, event);
    const completedItem =
      method === 'item/completed' ? itemCompletedNotificationSchema.safeParse(message.params) : null;
    if (completedItem?.success && this.captureCompletedItem(completedItem.data.item, tracker)) return;
    if (method !== 'turn/completed') return;
    this.completeTurn(message, tracker);
  }

  private captureCompletedItem(item: JsonObject, tracker: TurnTracker) {
    if (item.type === 'agentMessage') {
      const parsed = agentMessageCompletedItemSchema.safeParse(item);
      if (!parsed.success) return true;
      if (parsed.data.phase === 'final_answer' || !tracker.finalMessage) tracker.finalMessage = parsed.data.text;
      return true;
    }
    if (item.type === 'imageGeneration') {
      const parsed = imageGenerationCompletedItemSchema.safeParse(item);
      if (!parsed.success) return true;
      tracker.image = {
        savedPath: parsed.data.savedPath ?? null,
        revisedPrompt: parsed.data.revisedPrompt ?? null,
        result: parsed.data.result ?? '',
      };
      return true;
    }
    return false;
  }

  private completeTurn(message: RpcMessage, tracker: TurnTracker) {
    tracker.timeouts.clear();
    this.turns.delete(tracker.turnId);
    const completed = turnCompletedNotificationSchema.safeParse(message.params);
    if (!completed.success) {
      tracker.reject(
        Object.assign(new Error('Codex App Server sent an invalid turn completion'), {
          code: 'INVALID_TURN_COMPLETION',
        }),
      );
      return;
    }
    const status = completed.data.turn.status;
    if (status === 'completed') {
      const hasImageResponse = Boolean(tracker.image?.savedPath || tracker.image?.result.trim());
      if (!tracker.finalMessage.trim() && !hasImageResponse) {
        tracker.reject(new CodexAppServerEmptyResponseError(tracker.threadId, tracker.turnId, tracker.usage));
        return;
      }
      tracker.resolve({
        threadId: tracker.threadId,
        turnId: tracker.turnId,
        status: 'completed',
        finalMessage: tracker.finalMessage,
        image: tracker.image,
        usage: tracker.usage,
      });
      return;
    }
    const messageText = completed.data.turn.error?.message
      ? completed.data.turn.error.message
      : status === 'interrupted'
        ? 'Codex App Server turn was interrupted'
        : 'Codex App Server turn failed';
    tracker.reject(
      status === 'interrupted'
        ? Object.assign(new Error(messageText), { code: 'INTERRUPTED' as const })
        : new Error(messageText),
    );
  }

  private emitTurnEvent(tracker: TurnTracker, event: CodexAppServerTurnEvent) {
    try {
      tracker.onEvent?.(event);
    } catch {
      // Turn observers are auxiliary; a callback failure must not kill the shared connection.
    }
  }

  private turnIdFromCompleted(message: RpcMessage) {
    if (message.method !== 'turn/completed') return null;
    const parsed = turnCompletedNotificationSchema.safeParse(message.params);
    return parsed.success ? parsed.data.turn.id : null;
  }

  private failConnection(error: Error) {
    for (const request of this.requests.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.requests.clear();
    for (const turn of this.turns.values()) {
      turn.timeouts.clear();
      turn.reject(error);
    }
    this.turns.clear();
    this.earlyTurnMessages.clear();
    this.earlyTurnDroppedMessages.clear();
    this.earlyTurnBytes.clear();
    this.earlyTurnBufferedBytes = 0;
    this.child = null;
  }
}
