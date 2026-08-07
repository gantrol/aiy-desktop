import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import { z } from 'zod';
import type { AssistantReasoningEffort, CodexTextModelDto } from '@/shared/contracts';

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

const modelCatalogEntrySchema = z
  .object({
    model: z.string().max(200).optional(),
    displayName: z.string().max(200).optional(),
    inputModalities: z.array(z.string().max(100)).max(20).optional(),
    isDefault: z.boolean().optional(),
    defaultReasoningEffort: z.string().max(100).nullable().optional(),
    supportedReasoningEfforts: z
      .array(z.object({ reasoningEffort: z.string().max(100).optional() }).passthrough())
      .max(20)
      .optional(),
  })
  .passthrough();

const modelCatalogResponseSchema = z
  .object({
    data: z.array(modelCatalogEntrySchema).max(10_000),
    nextCursor: z.string().max(2_000).nullable().optional(),
  })
  .passthrough();

const ignoredResponseSchema = z.unknown();

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
}

export interface CodexAppServerTurnEvent {
  method: string;
  itemType?: string;
  message?: string;
}

interface TurnTracker {
  threadId: string;
  turnId: string;
  finalMessage: string;
  image: CodexAppServerImageResult | null;
  onEvent?: (event: CodexAppServerTurnEvent) => void;
  resolve(value: CodexAppServerTurnResult): void;
  reject(reason: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface StartThreadInput {
  cwd: string;
  developerInstructions: string;
  webSearchMode?: 'disabled' | 'live';
}

export interface StartTurnInput {
  threadId: string;
  cwd: string;
  text: string;
  model?: string;
  effort?: AssistantReasoningEffort;
  localImages?: string[];
  outputSchema?: JsonObject;
  timeoutMs: number;
  onStarted?(cancel: () => void, turnId: string): void;
  onEvent?(event: CodexAppServerTurnEvent): void;
}

export class CodexAppServerRpcError extends Error {
  constructor(
    message: string,
    readonly rpcCode?: number,
    readonly rpcData?: unknown,
  ) {
    super(message);
    this.name = 'CodexAppServerRpcError';
  }
}

const MAX_LINE_BYTES = 16 * 1024 * 1024;
const reasoningEffortSchema = z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);

function reasoningEffort(value: unknown): AssistantReasoningEffort | null {
  const parsed = reasoningEffortSchema.safeParse(value);
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

function jsonObject(value: unknown): JsonObject | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : undefined;
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
  private readonly earlyTurnMessages = new Map<string, RpcMessage[]>();

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
        ephemeral: false,
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
        ephemeral: false,
        threadSource: 'aiy_beauty_dictionary',
      },
      threadResponseSchema,
      30_000,
    );
  }

  async setThreadName(threadId: string, name: string) {
    await this.request('thread/name/set', { threadId, name }, ignoredResponseSchema, 15_000);
  }

  async listModels(): Promise<CodexTextModelDto[]> {
    const models = new Map<string, CodexTextModelDto>();
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const response = await this.request(
        'model/list',
        { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) },
        modelCatalogResponseSchema,
        30_000,
      );
      for (const raw of response.data) {
        const key = raw.model?.trim() ?? '';
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
      const nextCursor = response.nextCursor?.trim() || undefined;
      if (!nextCursor || nextCursor === cursor) break;
      cursor = nextCursor;
    }
    return [...models.values()];
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
      const tracker: TurnTracker = {
        threadId: input.threadId,
        turnId,
        finalMessage: '',
        image: null,
        onEvent: input.onEvent,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.turns.delete(turnId);
          void this.interruptTurn(input.threadId, turnId);
          reject(new Error('Codex App Server turn timed out'));
        }, input.timeoutMs),
      };
      this.turns.set(turnId, tracker);
      const cancel = () => {
        void this.interruptTurn(input.threadId, turnId);
      };
      input.onStarted?.(cancel, turnId);
      for (const message of this.earlyTurnMessages.get(turnId) ?? []) this.routeTurnMessage(message, tracker);
      this.earlyTurnMessages.delete(turnId);
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
    this.failConnection(new Error('Codex App Server connection closed'));
    this.child?.kill();
    this.child = null;
  }

  private async request<T>(method: string, params: JsonObject, schema: z.ZodType<T>, timeoutMs: number): Promise<T> {
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
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
        this.failConnection(new Error('Codex App Server sent an oversized message'));
        child.kill();
        return;
      }
      try {
        this.handleMessage(parseRpcMessage(line));
      } catch (error) {
        this.failConnection(error instanceof Error ? error : new Error(String(error)));
        child.kill();
      }
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

  private sendRequest<T>(method: string, params: JsonObject, schema: z.ZodType<T>, timeoutMs: number): Promise<T> {
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
        this.send({ method, id, params });
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
    const buffered = this.earlyTurnMessages.get(turnId) ?? [];
    if (buffered.length < 100) buffered.push(message);
    this.earlyTurnMessages.set(turnId, buffered);
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
    const method = message.method ?? '';
    const item = jsonObject(message.params?.item);
    const itemType = typeof item?.type === 'string' ? item.type : undefined;
    tracker.onEvent?.({ method, itemType });
    if (method === 'item/completed' && itemType === 'agentMessage') {
      const text = typeof item?.text === 'string' ? item.text : '';
      const phase = typeof item?.phase === 'string' ? item.phase : '';
      if (phase === 'final_answer' || !tracker.finalMessage) tracker.finalMessage = text;
      return;
    }
    if (method === 'item/completed' && itemType === 'imageGeneration') {
      tracker.image = {
        savedPath: typeof item?.savedPath === 'string' ? item.savedPath : null,
        revisedPrompt: typeof item?.revisedPrompt === 'string' ? item.revisedPrompt : null,
        result: typeof item?.result === 'string' ? item.result : '',
      };
      return;
    }
    if (method === 'error' && message.params?.willRetry === false) {
      const error = jsonObject(message.params.error);
      const errorMessage = typeof error?.message === 'string' ? error.message : 'Codex App Server turn failed';
      tracker.onEvent?.({ method, message: errorMessage });
      return;
    }
    if (method !== 'turn/completed') return;
    clearTimeout(tracker.timer);
    this.turns.delete(tracker.turnId);
    const turn = jsonObject(message.params?.turn);
    const status = typeof turn?.status === 'string' ? turn.status : 'failed';
    if (status === 'completed') {
      tracker.resolve({
        threadId: tracker.threadId,
        turnId: tracker.turnId,
        status: 'completed',
        finalMessage: tracker.finalMessage,
        image: tracker.image,
      });
      return;
    }
    const turnError = jsonObject(turn?.error);
    const messageText =
      typeof turnError?.message === 'string'
        ? turnError.message
        : status === 'interrupted'
          ? 'Codex App Server turn was interrupted'
          : 'Codex App Server turn failed';
    tracker.reject(new Error(messageText));
  }

  private turnIdFromCompleted(message: RpcMessage) {
    if (message.method !== 'turn/completed') return null;
    const turn = jsonObject(message.params?.turn);
    return typeof turn?.id === 'string' ? turn.id : null;
  }

  private failConnection(error: Error) {
    for (const request of this.requests.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.requests.clear();
    for (const turn of this.turns.values()) {
      clearTimeout(turn.timer);
      turn.reject(error);
    }
    this.turns.clear();
    this.earlyTurnMessages.clear();
    this.child = null;
  }
}
