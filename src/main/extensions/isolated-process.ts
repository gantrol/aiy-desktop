import { fork, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { UtilityProcess } from 'electron';
import { createExtensionProcessDiagnostics } from '@/main/extensions/process-diagnostics';
import { isExtensionDiagnostic } from '@/main/extensions/diagnostic-protocol';

/** A native fault in an optional runtime must never share the application's process. */
export class IsolatedExtensionProcess extends EventEmitter {
  private readonly child: ChildProcess | UtilityProcess;
  private readonly diagnostics: ReturnType<typeof createExtensionProcessDiagnostics>;
  private stopped = false;
  private spawned = false;
  private failed = false;
  private readonly stopOnParentExit = () => this.terminate();

  constructor(entry: string, serviceName: string) {
    super();
    this.diagnostics = createExtensionProcessDiagnostics(serviceName);
    this.diagnostics?.record('process-starting');
    const env = { ...process.env };
    delete env.AIY_EXTENSION_DIAGNOSTICS;
    if (this.diagnostics) env.AIY_EXTENSION_DIAGNOSTICS = '1';
    for (const key of Object.keys(env)) {
      if (key.endsWith('_API_KEY') || ['HF_TOKEN', 'HUGGING_FACE_HUB_TOKEN', 'NODE_OPTIONS'].includes(key))
        delete env[key];
    }
    try {
      if (process.type === 'browser') {
        const { utilityProcess } = createRequire(__filename)('electron') as typeof import('electron');
        delete env.ELECTRON_RUN_AS_NODE;
        this.child = utilityProcess.fork(entry, [], {
          env,
          execArgv: [],
          stdio: this.diagnostics ? ['ignore', 'inherit', 'pipe'] : 'inherit',
          serviceName,
        });
      } else {
        // Plain Node consumers do not have Electron's main-process APIs. Never
        // bypass packaged runAsNode fuses to fork Electron from a utility process.
        if (process.versions.electron) throw new Error('EXTENSION_PROCESS_REQUIRES_MAIN');
        const options = { env, execArgv: [], serialization: 'advanced' as const, windowsHide: true };
        const child = fork(entry, [], options);
        this.child = child;
        child.unref();
      }
    } catch (error) {
      this.diagnostics?.failed(error);
      throw error;
    }
    process.once('exit', this.stopOnParentExit);
    const events: EventEmitter = this.child;
    events.on('spawn', () => {
      this.spawned = true;
      this.diagnostics?.spawned(this.child.pid);
      if (this.stopped) this.child.kill();
    });
    events.on('message', (message: unknown) => {
      if (isExtensionDiagnostic(message)) {
        this.diagnostics?.worker(message);
        return;
      }
      if (!this.stopped) {
        this.diagnostics?.message('receive', message);
        this.emit('message', message);
      }
    });
    events.on('error', (error: unknown) => {
      this.failed = true;
      this.diagnostics?.failed(error);
      if (!this.stopped) this.emit('error', error instanceof Error ? error : new Error('EXTENSION_PROCESS_FAILED'));
    });
    events.once('exit', (code: number | null, signal?: string | null) => {
      this.diagnostics?.exited(code, signal ?? null, this.stopped && !this.failed);
      this.stopped = true;
      process.removeListener('exit', this.stopOnParentExit);
      this.emit('exit', code);
    });
    if (this.diagnostics) {
      this.child.stderr?.on('data', (chunk: Buffer) => this.diagnostics?.stderr(chunk));
      this.child.stderr?.once('end', () => this.diagnostics?.stderrEnded());
      this.child.stderr?.on('error', (error: Error) => this.diagnostics?.failed(error));
    }
    if ('channel' in this.child) this.child.channel?.unref();
  }

  postMessage(message: unknown) {
    if (this.stopped) throw new Error('EXTENSION_PROCESS_STOPPED');
    this.diagnostics?.message('send', message);
    if ('postMessage' in this.child) this.child.postMessage(message);
    else
      this.child.send(message as object, (error) => {
        if (error && !this.stopped) this.emit('error', error);
      });
  }

  recordDiagnostic(event: string, details: object = {}) {
    this.diagnostics?.record(event, details);
  }

  terminate(reason = 'shutdown') {
    if (!this.stopped) this.diagnostics?.record('process-stop-requested', { reason });
    this.stopped = true;
    process.removeListener('exit', this.stopOnParentExit);
    // utilityProcess.kill() before spawn does not terminate the future child.
    if (this.spawned) this.child.kill();
  }
}
