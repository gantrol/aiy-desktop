import { spawn } from 'node:child_process';
import { BenchError, lines } from './metrics.mjs';

export class Rpc {
  constructor(command, args, cwd, env) {
    this.pending = new Map();
    this.listeners = new Set();
    this.sequence = 0;
    this.failure = null;
    this.closed = false;
    this.sampleStdoutBytes = 0;
    this.child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Drain, but deliberately do not retain/export stderr: it may contain private paths or credentials.
    this.child.stderr.resume();
    this.child.stdin.on('error', () => this.fail(new BenchError('PROCESS_INPUT_FAILED')));
    this.child.once('error', () => this.fail(new BenchError('PROCESS_START_FAILED')));
    this.closedPromise = new Promise((resolve) =>
      this.child.once('close', () => {
        this.closed = true;
        this.fail(new BenchError('PROCESS_CLOSED'));
        resolve(true);
      }),
    );
    void this.read().catch((error) =>
      this.fail(error instanceof BenchError ? error : new BenchError('INVALID_RPC_STREAM')),
    );
  }

  beginSample() {
    if (this.failure) throw this.failure;
    this.sampleStdoutBytes = 0;
  }

  async *sampleOutput() {
    for await (const chunk of this.child.stdout) {
      this.sampleStdoutBytes += chunk.byteLength;
      if (this.sampleStdoutBytes > 64 * 1024 * 1024) throw new BenchError('RESPONSE_TOO_LARGE');
      yield chunk;
    }
  }

  async read() {
    // The process survives successful samples. Its byte budget does not, while
    // lines() still bounds every frame (including an unterminated one) to 1 MiB.
    for await (const line of lines(this.sampleOutput(), Infinity)) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new BenchError('INVALID_RPC');
      if (message.method && message.id !== undefined) {
        // Never approve server requests or execute a client-side tool during a benchmark.
        this.send({
          id: message.id,
          error: {
            code: -32601,
            message: 'Benchmark denies tools and approvals',
          },
        });
        for (const listener of this.listeners) listener({ method: 'bench/deniedRequest', params: {} });
      } else if (message.id !== undefined) {
        const request = this.pending.get(message.id);
        if (!request) continue;
        this.pending.delete(message.id);
        request.cleanup();
        if (message.error) request.reject(new BenchError('RPC_REJECTED'));
        else request.resolve(message.result);
      } else if (typeof message.method === 'string') {
        for (const listener of this.listeners) listener(message);
      }
    }
    this.fail(new BenchError('RPC_STREAM_ENDED'));
  }

  send(message) {
    if (this.failure) throw this.failure;
    const line = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(line) > 1024 * 1024) throw new BenchError('REQUEST_TOO_LARGE');
    this.child.stdin.write(line);
  }

  call(method, params, signal, timeoutMs = 30_000) {
    if (this.failure) return Promise.reject(this.failure);
    if (signal?.aborted) return Promise.reject(new BenchError('DEADLINE_EXCEEDED'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const finish = (code) => {
        this.pending.delete(id);
        cleanup();
        reject(new BenchError(code));
      };
      const onAbort = () => finish('DEADLINE_EXCEEDED');
      const timer = setTimeout(() => finish('RPC_TIMEOUT'), timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      this.pending.set(id, { resolve, reject, cleanup });
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        this.send({ id, method, params });
      } catch {
        finish('PROCESS_INPUT_FAILED');
      }
    });
  }

  fail(error) {
    this.failure ??= error;
    for (const request of this.pending.values()) {
      request.cleanup();
      request.reject(this.failure);
    }
    this.pending.clear();
    for (const listener of this.listeners) listener({ method: 'bench/disconnected', params: {} });
  }

  async close() {
    if (this.closed) return true;
    this.child.stdin.end();
    let timer;
    const wait = (ms) =>
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      });
    let closed = await Promise.race([this.closedPromise, wait(500)]);
    clearTimeout(timer);
    if (closed) return true;
    this.child.kill('SIGTERM');
    closed = await Promise.race([this.closedPromise, wait(1000)]);
    clearTimeout(timer);
    if (closed) return true;
    this.child.kill('SIGKILL');
    closed = await Promise.race([this.closedPromise, wait(1000)]);
    clearTimeout(timer);
    return closed;
  }
}
