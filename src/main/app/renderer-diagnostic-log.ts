import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const fileLimit = 2 * 1024 * 1024;
const backlogLimit = 256 * 1024;

export class RendererDiagnosticLog {
  private tail = Promise.resolve();
  private pendingBytes = 0;
  private dropped = 0;
  private size: number | null = null;
  private warned = false;

  constructor(private readonly directory: string) {}

  write(record: object) {
    const line =
      JSON.stringify({ at: new Date().toISOString(), pid: process.pid, dropped: this.dropped, ...record }) + '\n';
    const bytes = Buffer.byteLength(line);
    if (bytes > 16_384 || this.pendingBytes + bytes > backlogLimit) {
      this.dropped += 1;
      return;
    }
    this.dropped = 0;
    this.pendingBytes += bytes;
    this.tail = this.tail
      .then(() => this.append(line, bytes))
      .catch(() => {
        this.size = null;
        this.dropped += 1;
        if (!this.warned) console.warn('[renderer-diagnostics] Local log write failed');
        this.warned = true;
      })
      .finally(() => {
        this.pendingBytes -= bytes;
      });
  }

  private async append(line: string, bytes: number) {
    const current = path.join(this.directory, 'renderer-current.jsonl');
    if (this.size === null) {
      await mkdir(this.directory, { recursive: true });
      this.size = await stat(current)
        .then((file) => file.size)
        .catch((error: unknown) => {
          if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return 0;
          throw error;
        });
    }
    if (this.size + bytes > fileLimit) {
      const previous = path.join(this.directory, 'renderer-previous.jsonl');
      await rm(previous, { force: true });
      await rename(current, previous);
      this.size = 0;
    }
    await appendFile(current, line, 'utf8');
    this.size += bytes;
  }

  async flush() {
    // A broken filesystem must not prevent the user from quitting.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.tail,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 500);
      }),
    ]);
    clearTimeout(timer);
  }
}
