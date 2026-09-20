import type { CalendarQueryInput, CalendarQueryResult } from '@/shared/contracts/calendar';

type PendingDay = {
  date: string;
  generation: number;
  run(): Promise<CalendarQueryResult>;
  resolve(value: CalendarQueryResult): void;
  reject(reason: Error): void;
};

/** First pages only: seven days, 700 entries at most, and a 2 MiB serialized-data budget. */
export class CalendarDayCache {
  private scope: object | null = null;
  private generation = 0;
  private running = 0;
  private bytes = 0;
  private queue: PendingDay[] = [];
  private cache = new Map<string, { value: CalendarQueryResult; bytes: number }>();
  private pending = new Map<string, Promise<CalendarQueryResult>>();

  reset(scope: object | null = null) {
    this.scope = scope;
    this.generation += 1;
    this.cancelQueued();
    this.cache.clear();
    this.pending.clear();
    this.bytes = 0;
  }

  cancelQueued(exceptDate?: string) {
    this.queue = this.queue.filter((task) => {
      if (task.date === exceptDate) return true;
      this.pending.delete(`${task.generation}:${task.date}`);
      task.reject(new Error('CALENDAR_REQUEST_SUPERSEDED'));
      return false;
    });
  }

  peek(date: string, scope: object) {
    return this.scope === scope ? (this.cache.get(date)?.value ?? null) : null;
  }

  read(query: CalendarQueryInput, spaceId: string, foreground = false): Promise<CalendarQueryResult> {
    const date = query.startDate;
    if (foreground) this.cancelQueued(date);
    const cached = this.cache.get(date);
    if (cached) {
      this.cache.delete(date);
      this.cache.set(date, cached);
      return Promise.resolve(cached.value);
    }
    const generation = this.generation;
    const key = `${generation}:${date}`;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const promise = new Promise<CalendarQueryResult>((resolve, reject) => {
      const task = { date, generation, run: () => window.desktopApi.calendar.query(query, spaceId), resolve, reject };
      if (foreground) this.queue.unshift(task);
      else this.queue.push(task);
    });
    this.pending.set(key, promise);
    this.drain();
    return promise;
  }

  private remember(date: string, value: CalendarQueryResult) {
    const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (bytes > 2 * 1024 * 1024) return;
    while (this.cache.size >= 7 || this.bytes + bytes > 2 * 1024 * 1024) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.cache.get(oldest)!.bytes;
      this.cache.delete(oldest);
    }
    this.cache.set(date, { value, bytes });
    this.bytes += bytes;
  }

  private drain() {
    while (this.running < 2 && this.queue.length) {
      const task = this.queue.shift()!;
      this.running += 1;
      void task
        .run()
        .then(
          (value) => {
            if (task.generation === this.generation) this.remember(task.date, value);
            task.resolve(value);
          },
          (reason: Error) => task.reject(reason),
        )
        .finally(() => {
          this.running -= 1;
          this.pending.delete(`${task.generation}:${task.date}`);
          this.drain();
        });
    }
  }
}
