import { randomUUID } from 'node:crypto';
import net from 'node:net';
import {
  MODEL_WORKER_PROTOCOL_VERSION,
  createModelWorkerServerMessageDecoder,
  encodeWorkerMessage,
  type ModelWorkerDescriptor,
  type ModelWorkerMethod,
  type ModelWorkerServerMessage,
  type ModelWorkerSnapshot,
} from '@/main/model-worker/protocol';

const CONNECT_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 120_000;

function clientError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

export class AgentCliWorkerClient {
  private socket: net.Socket | null = null;
  private snapshotValue: ModelWorkerSnapshot | null = null;
  private pending:
    | {
        id: string;
        resolve(value: unknown): void;
        reject(error: Error): void;
        timer: ReturnType<typeof setTimeout>;
      }
    | undefined;

  private constructor(private readonly descriptor: ModelWorkerDescriptor) {}

  static async connect(descriptor: ModelWorkerDescriptor) {
    if (descriptor.protocolVersion !== MODEL_WORKER_PROTOCOL_VERSION) {
      throw clientError(
        'AIY_AGENT_PROTOCOL_MISMATCH',
        'AIY background service uses an incompatible protocol; restart AIY after updating it',
      );
    }
    const client = new AgentCliWorkerClient(descriptor);
    await client.open();
    return client;
  }

  get snapshot() {
    if (!this.snapshotValue) throw clientError('AIY_AGENT_WORKER_UNAVAILABLE', 'AIY background service is not ready');
    return this.snapshotValue;
  }

  private open() {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = net.createConnection(this.descriptor.endpoint);
      this.socket = socket;
      const finish = (operation: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        operation();
      };
      const timer = setTimeout(
        () =>
          finish(() => {
            socket.destroy();
            reject(clientError('AIY_AGENT_WORKER_UNAVAILABLE', 'Timed out connecting to AIY'));
          }),
        CONNECT_TIMEOUT_MS,
      );
      const decode = createModelWorkerServerMessageDecoder((message) => {
        if (message.type === 'ready') {
          if (
            message.snapshot.protocolVersion !== this.descriptor.protocolVersion ||
            message.snapshot.runtimeFingerprint !== this.descriptor.runtimeFingerprint ||
            message.snapshot.workerId !== this.descriptor.workerId
          ) {
            finish(() => reject(clientError('AIY_AGENT_PROTOCOL_MISMATCH', 'AIY worker identity changed')));
            socket.destroy();
            return;
          }
          this.snapshotValue = message.snapshot;
          finish(resolve);
          return;
        }
        if (!settled) {
          const handshakeMessage =
            message.type === 'protocol-error' ? message.message : 'AIY sent a message before the worker was ready';
          finish(() => reject(clientError('AIY_AGENT_PROTOCOL_ERROR', handshakeMessage)));
          socket.destroy();
          return;
        }
        this.handleMessage(message);
      });
      socket.once('connect', () => {
        socket.write(
          encodeWorkerMessage({
            type: 'hello',
            protocolVersion: MODEL_WORKER_PROTOCOL_VERSION,
            token: this.descriptor.token,
            clientId: randomUUID(),
          }),
        );
      });
      socket.on('data', (chunk) => {
        try {
          decode(chunk);
        } catch {
          finish(() => reject(clientError('AIY_AGENT_PROTOCOL_ERROR', 'AIY sent an invalid protocol message')));
          socket.destroy();
        }
      });
      socket.once('error', (error) => {
        finish(() => reject(clientError('AIY_AGENT_WORKER_UNAVAILABLE', `Unable to connect to AIY: ${error.message}`)));
      });
      socket.once('close', () => {
        finish(() => reject(clientError('AIY_AGENT_WORKER_UNAVAILABLE', 'AIY background service closed')));
        this.rejectPending(clientError('AIY_AGENT_WORKER_UNAVAILABLE', 'AIY background service closed'));
      });
    });
  }

  private handleMessage(message: ModelWorkerServerMessage) {
    if (message.type === 'snapshot') {
      this.snapshotValue = message.snapshot;
      return;
    }
    if (message.type === 'protocol-error') {
      this.rejectPending(clientError('AIY_AGENT_PROTOCOL_ERROR', message.message));
      return;
    }
    if (message.type !== 'response' || !this.pending || message.id !== this.pending.id) return;
    const pending = this.pending;
    this.pending = undefined;
    clearTimeout(pending.timer);
    if ('error' in message) {
      pending.reject(clientError(message.error.code || 'AIY_AGENT_OPERATION_FAILED', message.error.message));
      return;
    }
    pending.resolve(message.result);
  }

  request(method: ModelWorkerMethod, params: unknown[]) {
    if (!this.socket || this.socket.destroyed) {
      return Promise.reject(clientError('AIY_AGENT_WORKER_UNAVAILABLE', 'AIY background service is disconnected'));
    }
    if (this.pending) {
      return Promise.reject(clientError('AIY_AGENT_CLIENT_BUSY', 'AIY agent client already has a pending request'));
    }
    const socket = this.socket;
    const id = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.pending = undefined;
        socket.write(encodeWorkerMessage({ type: 'cancel', id }));
        reject(clientError('AIY_AGENT_REQUEST_TIMEOUT', 'AIY agent request timed out'));
      }, REQUEST_TIMEOUT_MS);
      this.pending = { id, resolve, reject, timer };
      socket.write(encodeWorkerMessage({ type: 'request', id, method, params }));
    });
  }

  private rejectPending(error: Error) {
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = undefined;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  close() {
    this.rejectPending(clientError('AIY_AGENT_CLIENT_CLOSED', 'AIY agent client closed'));
    this.socket?.destroy();
    this.socket = null;
  }
}
