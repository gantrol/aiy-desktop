import { z } from 'zod';
import type { LibraryDatabase } from '@/main/database';
import {
  codexContentTaskSchema,
  codexProjectTargetSchema,
  codexContentExecutionSchema,
  type CodexContentExecution,
  type CodexContentTask,
  type CodexProjectTarget,
} from '@/shared/contracts/codex-content';

const taskInputSchema = z.object({ hash: z.string().min(1) }).strict();
export const outputRequestSchema = z.object({
  path: z.string(),
  hash: z.string(),
  requestId: z.string(),
  title: z.string(),
});
export type OutputRequest = z.infer<typeof outputRequestSchema>;
const taskRowSchema = z.object({ task_json: z.string(), input_json: z.string(), outputs_json: z.string() });
export class CodexContentRepository {
  private userThreadIds: readonly string[] | null = null;
  constructor(private readonly database: LibraryDatabase) {}
  private get db() {
    return this.database.db;
  }
  latest(stashId: string): CodexContentTask | null {
    const row = this.db
      .prepare('SELECT task_json FROM codex_content_tasks WHERE stash_id=? ORDER BY created_at DESC,id DESC LIMIT 1')
      .get(stashId);
    return row
      ? codexContentTaskSchema.parse(JSON.parse(z.object({ task_json: z.string() }).parse(row).task_json))
      : null;
  }
  hasActive(stashId: string) {
    return !!this.db
      .prepare("SELECT 1 FROM codex_content_tasks WHERE stash_id=? AND status IN ('STARTING','RUNNING','COLLECTING')")
      .get(stashId);
  }
  historyThreadIds(): readonly string[] {
    if (this.userThreadIds) return this.userThreadIds;
    const rows = this.db
      .prepare(
        `SELECT DISTINCT lower(json_extract(task_json,'$.threadId')) AS threadId
         FROM codex_content_tasks WHERE json_extract(task_json,'$.threadId') IS NOT NULL LIMIT 100001`,
      )
      .all();
    this.userThreadIds = z
      .array(z.object({ threadId: z.string().min(1).max(512) }))
      .max(100000)
      .parse(rows)
      .map(({ threadId }) => threadId);
    return this.userThreadIds;
  }
  get(id: string) {
    const row = this.db.prepare('SELECT task_json,input_json,outputs_json FROM codex_content_tasks WHERE id=?').get(id);
    if (!row) return null;
    const value = taskRowSchema.parse(row);
    return {
      task: codexContentTaskSchema.parse(JSON.parse(value.task_json)),
      input: taskInputSchema.parse(JSON.parse(value.input_json)),
      outputs: z.array(outputRequestSchema).parse(JSON.parse(value.outputs_json)),
    };
  }
  create(task: CodexContentTask, contentHash: string) {
    this.db
      .prepare(
        'INSERT INTO codex_content_tasks(id,stash_id,status,task_json,input_json,created_at) VALUES(?,?,?,?,?,?)',
      )
      .run(
        task.id,
        task.stashId,
        task.status,
        JSON.stringify(codexContentTaskSchema.parse(task)),
        JSON.stringify(taskInputSchema.parse({ hash: contentHash })),
        task.createdAt,
      );
  }
  update(task: CodexContentTask, outputs?: OutputRequest[]) {
    codexContentTaskSchema.parse(task);
    this.db
      .prepare('UPDATE codex_content_tasks SET status=?,task_json=?,outputs_json=COALESCE(?,outputs_json) WHERE id=?')
      .run(task.status, JSON.stringify(task), outputs ? JSON.stringify(outputs) : null, task.id);
    if (task.status === 'STARTING' && task.threadId) this.userThreadIds = null;
  }
  project(stashId: string) {
    const row = this.db.prepare('SELECT project_json FROM codex_content_preferences WHERE stash_id=?').get(stashId);
    return row
      ? codexProjectTargetSchema.parse(JSON.parse(z.object({ project_json: z.string() }).parse(row).project_json))
      : null;
  }
  selectProject(stashId: string, project: CodexProjectTarget) {
    this.db
      .prepare(
        'INSERT INTO codex_content_preferences(stash_id,project_json) VALUES(?,?) ON CONFLICT(stash_id) DO UPDATE SET project_json=excluded.project_json',
      )
      .run(stashId, JSON.stringify(project));
  }
  lastProject(): CodexProjectTarget | null {
    const raw = this.db.prepare("SELECT value FROM app_meta WHERE key='codex.content.last-project'").pluck().get();
    return typeof raw === 'string' ? codexProjectTargetSchema.parse(JSON.parse(raw)) : null;
  }
  rememberProject(project: CodexProjectTarget) {
    this.db
      .prepare(
        "INSERT INTO app_meta(key,value) VALUES('codex.content.last-project',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(codexProjectTargetSchema.parse(project)));
  }
  execution(stashId: string): CodexContentExecution {
    const raw = this.db
      .prepare('SELECT value FROM app_meta WHERE key=?')
      .pluck()
      .get(`codex.content.execution:${stashId}`);
    return codexContentExecutionSchema.parse(typeof raw === 'string' ? JSON.parse(raw) : {});
  }
  selectExecution(stashId: string, execution: CodexContentExecution) {
    this.db
      .prepare('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(`codex.content.execution:${stashId}`, JSON.stringify(codexContentExecutionSchema.parse(execution)));
  }
  selectAlbum(id: string, locale: 'en' | 'zh') {
    if (!this.database.listMaterialAlbums({ locale }).some((album) => album.id === id))
      throw new Error('[aiy-codex-content:collection]');
    this.db
      .prepare(
        "INSERT INTO app_meta(key,value) VALUES('codex.content.flower-album',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(id);
  }
  albumId(): string | null {
    const row = this.db.prepare("SELECT value FROM app_meta WHERE key='codex.content.flower-album'").get() as
      { value: string } | undefined;
    return row?.value ?? null;
  }
  ensureAlbum(title: string, locale: 'en' | 'zh' = 'en') {
    return this.db.transaction(() => {
      const existing = this.albumId();
      if (existing && this.database.listMaterialAlbums({ locale }).some((album) => album.id === existing))
        return existing;
      const album = this.database.createMaterialAlbum({ title, locale });
      this.db
        .prepare(
          "INSERT INTO app_meta(key,value) VALUES('codex.content.flower-album',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(album.id);
      return album.id;
    })();
  }
  recover() {
    this.discardLegacyMessages();
    const rows = this.db
      .prepare("SELECT id FROM codex_content_tasks WHERE status IN ('STARTING','RUNNING','COLLECTING')")
      .all() as { id: string }[];
    for (const { id } of rows) {
      const value = this.get(id)!;
      const collecting = value.task.status === 'COLLECTING';
      this.update({
        ...value.task,
        status: collecting ? 'COLLECTION_FAILED' : 'INTERRUPTED',
        errorCode: collecting ? 'collection' : 'interrupted',
        collectionRetryable: collecting && value.outputs.length === value.task.outputCount,
      });
    }
  }
  private discardLegacyMessages() {
    // Task history reads Codex's records. This store only owns execution and collection receipts.
    this.db.transaction(() => {
      const key = 'codex.content.receipts-only';
      if (this.db.prepare('SELECT 1 FROM app_meta WHERE key=?').get(key)) return;
      this.db
        .prepare(
          `UPDATE codex_content_tasks
           SET task_json=json_remove(task_json,'$.prompt','$.text','$.referenceAssetIds'),
               input_json=json_object('hash',json_extract(input_json,'$.hash'))`,
        )
        .run();
      this.db.prepare('INSERT INTO app_meta(key,value) VALUES(?,?)').run(key, '1');
    })();
  }
}
