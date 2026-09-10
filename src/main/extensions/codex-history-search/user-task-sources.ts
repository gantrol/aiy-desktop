import type Database from 'better-sqlite3';
import { z } from 'zod';
import sql from '@/main/database/sql/v03-codex-history-search-cache-revision-004-user-tasks.sql?raw';

/** Only provenance IDs live here; the history index remains the sole message store. */
export class CodexHistoryUserTaskSources {
  private registered: readonly string[] | null = null;

  constructor(private readonly database: Database.Database) {}

  hasSchema() {
    return z
      .array(z.object({ name: z.string() }))
      .parse(this.database.pragma('table_info(codex_history_user_tasks)'))
      .some((column) => column.name === 'thread_id');
  }

  ensureSchema() {
    this.database.exec(sql);
  }

  include(threadIds: readonly string[]) {
    if (threadIds === this.registered) return;
    if (threadIds.length) {
      this.database.transaction(() => {
        this.database
          .prepare('INSERT OR IGNORE INTO codex_history_user_tasks(thread_id) SELECT value FROM json_each(?)')
          .run(JSON.stringify(threadIds));
        this.apply();
      })();
    }
    this.registered = threadIds;
  }

  apply() {
    this.database
      .prepare(
        `UPDATE codex_history_threads SET thread_source='USER'
         WHERE thread_source='OTHER' AND thread_id IN (SELECT thread_id FROM codex_history_user_tasks)`,
      )
      .run();
  }

  clear() {
    this.database.prepare('DELETE FROM codex_history_user_tasks').run();
    this.registered = null;
  }
}
