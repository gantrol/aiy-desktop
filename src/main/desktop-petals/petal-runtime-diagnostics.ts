import { app } from 'electron';
import path from 'node:path';
import { RendererDiagnosticLog } from '@/main/app/renderer-diagnostic-log';
import type { PetalWindow } from '@/main/desktop-petals/petal-windows';

/** One sampler for the runtime. Shared processes are counted once; content never enters the log. */
export class PetalRuntimeDiagnostics {
  private readonly log = new RendererDiagnosticLog(path.join(app.getPath('userData'), 'diagnostics', 'petals'));
  private readonly timer: ReturnType<typeof setInterval>;
  constructor(private readonly entries: () => Iterable<PetalWindow>) {
    this.timer = setInterval(() => {
      try {
        this.sample();
      } catch {
        this.record('memory-unavailable');
      }
    }, 30_000);
    this.timer.unref();
  }
  record(event: string, details: object = {}) {
    this.log.write({ source: 'petals', event, details });
  }
  attach(entry: PetalWindow) {
    const contents = entry.window.webContents;
    const identity = {
      webContentsId: contents.id,
      kind: entry.drawer ? 'drawer' : entry.instanceId ? 'note' : 'hub',
      expanded: entry.expanded,
    };
    this.record('window-created', identity);
    contents.on('render-process-gone', (_event, details) => this.record('renderer-gone', { ...identity, ...details }));
    entry.window.on('closed', () => this.record('window-closed', identity));
  }
  sample() {
    const entries = [...this.entries()].filter((entry) => !entry.window.isDestroyed());
    const pids = new Set(entries.map((entry) => entry.window.webContents.getOSProcessId()));
    const processes = app.getAppMetrics().filter((metric) => pids.has(metric.pid));
    this.record('memory', {
      windows: entries.length,
      visible: entries.filter((entry) => entry.window.isVisible()).length,
      expanded: entries.filter((entry) => entry.expanded).length,
      processCount: processes.length,
      privateMemoryKB: processes.some((metric) => metric.memory.privateBytes === undefined)
        ? null
        : processes.reduce((total, metric) => total + (metric.memory.privateBytes ?? 0), 0),
      processes: processes.slice(0, 32).map((metric) => ({
        pid: metric.pid,
        memory: metric.memory,
        cpu: metric.cpu.percentCPUUsage,
      })),
      identities: entries.slice(0, 64).map((entry) => ({
        webContentsId: entry.window.webContents.id,
        pid: entry.window.webContents.getOSProcessId(),
        expanded: entry.expanded,
        visible: entry.window.isVisible(),
      })),
    });
  }
  dispose() {
    clearInterval(this.timer);
    void this.log.flush();
  }
}
