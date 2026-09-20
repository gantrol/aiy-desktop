import { performance } from 'node:perf_hooks';
import { BenchError, count, digest, elapsed, finishOutput } from './metrics.mjs';
import { Rpc } from './rpc.mjs';

// A deliberately small protocol probe, NOT a replacement for AIY's production Codex client.
export class AppServerProbe {
  constructor(binary, cwd, options = {}) {
    this.binary = binary;
    this.cwd = cwd;
    this.args = options.args ?? ['app-server', '--listen', 'stdio://'];
    this.environment = options.env ?? process.env;
    this.rpc = null;
    this.runtimeFingerprint = null;
  }

  async start(signal, sample) {
    const started = performance.now();
    sample.processStarted = !this.rpc;
    try {
      if (!this.rpc) {
        const env = { ...this.environment, NO_COLOR: '1' };
        for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'AIY_CODEX_BENCH_PROXY_KEY'])
          delete env[key];
        this.rpc = new Rpc(this.binary, this.args, this.cwd, env);
        const result = await this.rpc.call(
          'initialize',
          {
            clientInfo: {
              name: 'aiy_codex_transport_bench',
              title: 'AIY Codex transport benchmark',
              version: '1.0.0',
            },
            capabilities: { experimentalApi: true },
          },
          signal,
        );
        this.runtimeFingerprint = typeof result?.userAgent === 'string' ? digest(result.userAgent) : null;
        this.rpc.send({ method: 'initialized' });
      }
      sample.runtimeFingerprint = this.runtimeFingerprint;
    } finally {
      sample.timing.startupMs = elapsed(started);
    }
  }

  async catalog(signal) {
    const entries = [];
    const cursors = new Set();
    let cursor;
    for (let page = 0; page < 20; page += 1) {
      const response = await this.rpc.call(
        'model/list',
        { limit: 100, includeHidden: true, ...(cursor ? { cursor } : {}) },
        signal,
      );
      if (!Array.isArray(response?.data)) throw new BenchError('INVALID_CATALOG');
      entries.push(...response.data);
      const next = response.nextCursor;
      if (next == null) return entries;
      if (typeof next !== 'string' || !next || cursors.has(next)) throw new BenchError('CATALOG_INCOMPLETE');
      cursors.add(next);
      cursor = next;
    }
    throw new BenchError('CATALOG_INCOMPLETE');
  }

  async run({ request, fixture, signal, sample }) {
    // Include all startup/preflight/thread/turn output in this sample's budget.
    // The first Rpc starts at zero; reused processes begin a fresh budget here.
    this.rpc?.beginSample();
    await this.start(signal, sample);
    const preflight = performance.now();
    try {
      const [account, models] = await Promise.all([
        this.rpc.call('account/read', { refreshToken: false }, signal),
        this.catalog(signal),
      ]);
      if (account?.account?.type !== 'chatgpt') throw new BenchError('CHATGPT_SIGN_IN_REQUIRED');
      const model = models.find((entry) => (entry.model ?? entry.id) === request.model);
      if (!model) throw new BenchError('MODEL_NOT_LISTED');
      if (!model.supportedReasoningEfforts?.some((entry) => entry.reasoningEffort === request.effort)) {
        throw new BenchError('EFFORT_NOT_LISTED');
      }
      if (model.inputModalities && !model.inputModalities.includes('text')) throw new BenchError('TEXT_NOT_SUPPORTED');
    } finally {
      sample.timing.preflightMs = elapsed(preflight);
    }
    const threadStarted = performance.now();
    let threadId;
    try {
      const result = await this.rpc.call(
        'thread/start',
        {
          cwd: this.cwd,
          model: request.model,
          ephemeral: true,
          approvalPolicy: 'never',
          sandbox: 'read-only',
          developerInstructions: 'Complete the supplied text task without tools.',
          config: { web_search: 'disabled' },
        },
        signal,
      );
      threadId = result?.thread?.id;
      if (typeof threadId !== 'string' || !threadId) throw new BenchError('INVALID_THREAD');
      // result.model is configuration, not evidence of the model that executed a turn.
    } finally {
      sample.timing.threadMs = elapsed(threadStarted);
    }

    const started = performance.now();
    let observedTurnId = null;
    let acceptedTurnId = null;
    const messages = new Map();
    let resolveDone;
    let rejectDone;
    const done = new Promise((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    // Early turn events can arrive before the turn/start acknowledgement.
    void done.catch(() => {});
    const onAbort = () => rejectDone(new BenchError('DEADLINE_EXCEEDED'));
    const listener = (event) => {
      if (event.method === 'bench/disconnected')
        return rejectDone(this.rpc.failure ?? new BenchError('PROCESS_CLOSED'));
      if (event.method === 'bench/deniedRequest') {
        sample.toolCalls += 1;
        return rejectDone(new BenchError('TOOL_USE_NOT_ALLOWED'));
      }
      const params = event.params ?? {};
      if (params.threadId !== threadId) return;
      const turnId = params.turnId ?? params.turn?.id;
      if (typeof turnId !== 'string') return;
      if (observedTurnId && observedTurnId !== turnId) return;
      observedTurnId = turnId;
      sample.timing.firstEventMs ??= elapsed(started);
      if (event.method === 'item/agentMessage/delta' && typeof params.delta === 'string' && params.delta.length) {
        sample.timing.firstTextDeltaMs ??= elapsed(started);
      }
      if (/^item\/reasoning\/.+Delta$/.test(event.method) && typeof params.delta === 'string' && params.delta.length) {
        sample.timing.firstReasoningDeltaMs ??= elapsed(started);
      }
      if (event.method === 'thread/tokenUsage/updated') {
        const usage = params.tokenUsage?.last ?? {};
        sample.usage = {
          inputTokens: count(usage.inputTokens),
          cachedInputTokens: count(usage.cachedInputTokens),
          outputTokens: count(usage.outputTokens),
          reasoningOutputTokens: count(usage.reasoningOutputTokens),
        };
      }
      if (['item/started', 'item/completed'].includes(event.method) && params.item) {
        if (!['agentMessage', 'reasoning', 'userMessage'].includes(params.item.type)) {
          sample.toolCalls += 1;
          rejectDone(new BenchError('TOOL_USE_NOT_ALLOWED'));
        }
        if (event.method === 'item/completed' && params.item.type === 'agentMessage')
          messages.set(params.item.id, params.item);
      }
      if (event.method === 'turn/completed') {
        if (params.turn?.status !== 'completed') rejectDone(new BenchError('UPSTREAM_TERMINAL_FAILURE'));
        else resolveDone(params.turn);
      }
    };
    this.rpc.listeners.add(listener);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    try {
      const result = await this.rpc.call(
        'turn/start',
        {
          threadId,
          input: [{ type: 'text', text: fixture.prompt }],
          cwd: this.cwd,
          model: request.model,
          effort: request.effort,
          serviceTier: request.speed === 'fast' ? 'fast' : 'default',
          approvalPolicy: 'never',
          sandboxPolicy: {
            type: 'readOnly',
            access: {
              type: 'restricted',
              includePlatformDefaults: true,
              readableRoots: [this.cwd],
            },
          },
          ...(fixture.schema ? { outputSchema: fixture.schema } : {}),
        },
        signal,
      );
      sample.timing.acceptanceMs = elapsed(started);
      acceptedTurnId = result?.turn?.id;
      if (!acceptedTurnId || (observedTurnId && observedTurnId !== acceptedTurnId))
        throw new BenchError('INVALID_TURN');
      const completed = await done;
      if (typeof completed.model === 'string') {
        sample.reportedModel = completed.model.slice(0, 200);
        sample.reportedModelSource = 'turn.completed.model';
        if (sample.reportedModel !== request.model) throw new BenchError('REPORTED_MODEL_MISMATCH');
      }
      sample.reportedServiceTier =
        typeof completed.serviceTier === 'string' ? completed.serviceTier.slice(0, 100) : null;
      const candidates = messages.size
        ? [...messages.values()]
        : (completed.items ?? []).filter((item) => item.type === 'agentMessage');
      if ((completed.items ?? []).some((item) => !['agentMessage', 'reasoning', 'userMessage'].includes(item.type))) {
        throw new BenchError('TOOL_USE_NOT_ALLOWED');
      }
      const final = candidates.filter((item) => !item.phase || item.phase === 'final_answer');
      finishOutput(sample, final.map((item) => item.text ?? '').join(''), fixture);
    } catch (error) {
      const turnId = acceptedTurnId ?? observedTurnId;
      if (turnId) await this.rpc.call('turn/interrupt', { threadId, turnId }, undefined, 1000).catch(() => {});
      throw error;
    } finally {
      sample.timing.requestMs = elapsed(started);
      this.rpc.listeners.delete(listener);
      signal.removeEventListener('abort', onAbort);
    }
  }

  async close() {
    if (!this.rpc) return true;
    const closed = await this.rpc.close();
    if (closed) this.rpc = null;
    return closed;
  }
}
