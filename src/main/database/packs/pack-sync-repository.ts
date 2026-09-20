import { ulid } from 'ulid';
import type { LibraryStorage } from '@/main/database/core/storage';
import { packSyncItemSchema, type PackSyncItem, type PackSyncSummary } from '@/shared/pack-sync';

/** One explicit invocation owns one durable activity, including partial failure. */
export class PackSyncRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private begin(kind: PackSyncSummary['kind']) {
    const id = ulid();
    this.storage.db
      .prepare(
        `INSERT INTO pack_sync_runs(id,kind,status,started_at,items_json)
      VALUES (?,?,'RUNNING',?,'[]')`,
      )
      .run(id, kind, new Date().toISOString());
    return id;
  }

  run<T>(kind: PackSyncSummary['kind'], task: (syncRunId: string) => T): T {
    const id = this.begin(kind);
    try {
      const result = task(id);
      this.finish(id, 'SUCCEEDED');
      return result;
    } catch (error) {
      this.finish(id, 'FAILED');
      throw error;
    }
  }

  async runAsync<T>(kind: PackSyncSummary['kind'], task: (syncRunId: string) => Promise<T>): Promise<T> {
    const id = this.begin(kind);
    try {
      const result = await task(id);
      this.finish(id, 'SUCCEEDED');
      return result;
    } catch (error) {
      this.finish(id, 'FAILED');
      throw error;
    }
  }

  recordItem(id: string, raw: PackSyncItem) {
    const item = packSyncItemSchema.parse(raw);
    this.storage.db.transaction(() => {
      const existing = this.storage.db
        .prepare("SELECT items_json FROM pack_sync_runs WHERE id=? AND status='RUNNING'")
        .pluck()
        .get(id);
      if (typeof existing !== 'string') throw new Error('Pack sync run is not active');
      const items = packSyncItemSchema.array().max(100).parse(JSON.parse(existing));
      const index = items.findIndex((value) => value.packId === item.packId);
      if (index < 0) items.push(item);
      else items[index] = item;
      if (items.length > 100) throw new Error('Too many packs in one sync run');
      this.storage.db.prepare('UPDATE pack_sync_runs SET items_json=? WHERE id=?').run(JSON.stringify(items), id);
    })();
  }

  private finish(id: string, status: PackSyncSummary['status']) {
    this.storage.db.transaction(() => {
      const row = this.storage.db
        .prepare("SELECT items_json FROM pack_sync_runs WHERE id=? AND status='RUNNING'")
        .get(id) as { items_json: string } | undefined;
      if (!row) return;
      const items = packSyncItemSchema
        .array()
        .parse(JSON.parse(row.items_json))
        .map((item) => ({
          ...item,
          status: item.status === 'RUNNING' ? status : item.status,
        }));
      // An already-current package has no attempt or calendar activity to retain.
      if (!items.length && status === 'SUCCEEDED') {
        this.storage.db.prepare('DELETE FROM pack_sync_runs WHERE id=?').run(id);
        return;
      }
      this.storage.db
        .prepare('UPDATE pack_sync_runs SET status=?,finished_at=?,items_json=? WHERE id=?')
        .run(status, new Date().toISOString(), JSON.stringify(items), id);
      this.storage.recordChange('PACK_SYNC_RUN', id, status, { syncRunId: id }, { affectsFileView: false });
    })();
  }

  interruptRunning() {
    const rows = this.storage.db.prepare("SELECT id FROM pack_sync_runs WHERE status='RUNNING'").all() as {
      id: string;
    }[];
    for (const { id } of rows) this.finish(id, 'INTERRUPTED');
  }
}
