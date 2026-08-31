import { ulid } from 'ulid';
import type { AssistantReasoningEffort, Locale } from '@/shared/contracts';
import {
  articleCheckResultSchema,
  articleCheckRunApplyResultSchema,
  articleCheckRunSchema,
  type ArticleCheckExecutionResult,
  type ArticleCheckResult,
  type ArticleCheckRunApplyResult,
  type ArticleCheckRunDto,
  type ArticleCheckRunsListInput,
  type ArticleCheckRunsPage,
} from '@/shared/contracts/article';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, now, text } from '@/main/database/core/values';
import type { ArticleRepository } from '@/main/database/creations/article-repository';

const ARTICLE_CHECK_RUN_PROJECTION = `
  id, article_id, input_revision_id, article_title, locale,
  provider_key, requested_model, reasoning_effort, status, finding_count,
  comment_ids_json, error_code, error_message, started_at, finished_at, applied_at`;

function encodeOffsetCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function decodeOffsetCursor(value: string | null | undefined) {
  if (!value) return 0;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    const offset = parsed && typeof parsed === 'object' && 'offset' in parsed ? parsed.offset : undefined;
    if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error();
    return offset;
  } catch {
    throw new Error('Invalid article check run cursor');
  }
}

function stringArray(value: unknown) {
  if (typeof value !== 'string') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('Stored article check comment identities are invalid');
  }
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('Stored article check comment identities are invalid');
  }
  return parsed;
}

export function articleCheckRunDto(row: JsonMap): ArticleCheckRunDto {
  return articleCheckRunSchema.parse({
    id: text(row.id),
    articleId: text(row.article_id),
    inputRevisionId: text(row.input_revision_id),
    articleTitle: text(row.article_title),
    locale: text(row.locale),
    providerKey: text(row.provider_key),
    requestedModel: text(row.requested_model),
    reasoningEffort: text(row.reasoning_effort),
    status: text(row.status),
    findingCount: row.finding_count === null ? null : Number(row.finding_count),
    commentIds: stringArray(row.comment_ids_json),
    errorCode: row.error_code ? text(row.error_code) : null,
    errorMessage: row.error_message ? text(row.error_message) : null,
    startedAt: text(row.started_at),
    finishedAt: row.finished_at ? text(row.finished_at) : null,
    appliedAt: row.applied_at ? text(row.applied_at) : null,
  });
}

export function articleCheckRunFailure(reason: unknown) {
  const source = reason && typeof reason === 'object' ? reason : null;
  const rawCode = source && 'code' in source && typeof source.code === 'string' ? source.code : 'ARTICLE_CHECK_FAILED';
  const code = rawCode.trim().slice(0, 100) || 'ARTICLE_CHECK_FAILED';
  const rawMessage = reason instanceof Error ? reason.message : String(reason);
  const message = rawMessage.trim().slice(0, 2_000) || 'Article check failed';
  return { code, message };
}

export class ArticleCheckRunRepository {
  constructor(
    private readonly storage: LibraryStorage,
    private readonly articles: ArticleRepository,
  ) {}

  private get db() {
    return this.storage.db;
  }

  list(input: ArticleCheckRunsListInput): ArticleCheckRunsPage {
    const offset = decodeOffsetCursor(input.cursor);
    const limit = Math.min(input.limit ?? 100, 200);
    const rows = this.db
      .prepare(
        `SELECT ${ARTICLE_CHECK_RUN_PROJECTION} FROM article_check_runs
        ORDER BY started_at DESC, id DESC
        LIMIT ? OFFSET ?`,
      )
      .all(limit + 1, offset) as JsonMap[];
    const hasMore = rows.length > limit;
    return {
      items: (hasMore ? rows.slice(0, limit) : rows).map(articleCheckRunDto),
      nextCursor: hasMore ? encodeOffsetCursor(offset + limit) : null,
    };
  }

  start(input: {
    articleId: string;
    expectedRevisionId: string;
    locale: Locale;
    providerKey: string;
    requestedModel: string;
    reasoningEffort: AssistantReasoningEffort;
  }): ArticleCheckRunDto {
    return this.db
      .transaction(() => {
        const article = this.articles.get(input.articleId);
        if (article.revisionId !== input.expectedRevisionId) {
          throw new Error('The article changed before its check could start');
        }
        const existing = this.db
          .prepare("SELECT id FROM article_check_runs WHERE article_id = ? AND status = 'RUNNING'")
          .get(input.articleId) as JsonMap | undefined;
        if (existing) throw new Error('An article check is already running for this article');

        const id = ulid();
        const startedAt = now();
        this.db
          .prepare(
            `INSERT INTO article_check_runs (
            id, article_id, input_revision_id, article_title, locale,
            provider_key, requested_model, reasoning_effort, status,
            finding_count, result_json, comment_ids_json, error_code, error_message,
            started_at, finished_at, applied_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', NULL, NULL, '[]', NULL, NULL, ?, NULL, NULL)`,
          )
          .run(
            id,
            input.articleId,
            input.expectedRevisionId,
            article.content.title,
            input.locale,
            input.providerKey,
            input.requestedModel,
            input.reasoningEffort,
            startedAt,
          );
        this.storage.recordChange('ARTICLE_CHECK_RUN', id, 'CREATE', {
          articleId: input.articleId,
          inputRevisionId: input.expectedRevisionId,
        });
        return this.get(id);
      })
      .immediate();
  }

  complete(runId: string, rawResult: ArticleCheckResult): ArticleCheckExecutionResult {
    return this.db
      .transaction(() => {
        const result = articleCheckResultSchema.parse(rawResult);
        const finishedAt = now();
        const appliedAt = result.findings.length === 0 ? finishedAt : null;
        const updated = this.db
          .prepare(
            `UPDATE article_check_runs
          SET status = 'SUCCEEDED', finding_count = ?, result_json = ?, finished_at = ?, applied_at = ?
          WHERE id = ? AND status = 'RUNNING'`,
          )
          .run(result.findings.length, JSON.stringify(result), finishedAt, appliedAt, runId);
        if (updated.changes !== 1) throw new Error('Article check run is no longer active');
        this.storage.recordChange('ARTICLE_CHECK_RUN', runId, 'SUCCEED', {
          findingCount: result.findings.length,
          applied: result.findings.length === 0,
        });
        return { run: this.get(runId), findings: result.findings };
      })
      .immediate();
  }

  fail(runId: string, reason: unknown): ArticleCheckRunDto {
    return this.db
      .transaction(() => {
        const failure = articleCheckRunFailure(reason);
        const finishedAt = now();
        const updated = this.db
          .prepare(
            `UPDATE article_check_runs
          SET status = 'FAILED', error_code = ?, error_message = ?, finished_at = ?
          WHERE id = ? AND status = 'RUNNING'`,
          )
          .run(failure.code, failure.message, finishedAt, runId);
        if (updated.changes === 1) {
          this.storage.recordChange('ARTICLE_CHECK_RUN', runId, 'FAIL', {
            errorCode: failure.code,
          });
        }
        return this.get(runId);
      })
      .immediate();
  }

  apply(runId: string): ArticleCheckRunApplyResult {
    return this.db
      .transaction(() => {
        const run = this.get(runId);
        if (run.status !== 'SUCCEEDED') throw new Error('Article check results are not ready');
        if (run.appliedAt) {
          const article = this.articles.get(run.articleId);
          return articleCheckRunApplyResultSchema.parse({
            run,
            articleId: article.id,
            revisionId: article.revisionId,
            createdCommentIds: run.commentIds,
            comments: article.comments,
          });
        }
        const row = this.row(runId);
        let storedResult: unknown;
        try {
          storedResult = JSON.parse(text(row.result_json)) as unknown;
        } catch {
          throw new Error('Stored article check results are invalid');
        }
        const result = articleCheckResultSchema.parse(storedResult);
        const application = this.articles.applyCheck({
          articleId: run.articleId,
          expectedRevisionId: run.inputRevisionId,
          findings: result.findings,
        });
        const appliedAt = now();
        const updated = this.db
          .prepare(
            `UPDATE article_check_runs
          SET comment_ids_json = ?, applied_at = ?
          WHERE id = ? AND status = 'SUCCEEDED' AND applied_at IS NULL`,
          )
          .run(JSON.stringify(application.createdCommentIds), appliedAt, runId);
        if (updated.changes !== 1) throw new Error('Article check results were already applied');
        this.storage.recordChange('ARTICLE_CHECK_RUN', runId, 'APPLY', {
          articleId: run.articleId,
          commentIds: application.createdCommentIds,
        });
        const appliedRun = this.get(runId);
        const article = this.articles.get(run.articleId);
        return articleCheckRunApplyResultSchema.parse({
          ...application,
          comments: article.comments,
          run: appliedRun,
        });
      })
      .immediate();
  }

  interruptRunningAtStartup() {
    return this.db.transaction(() => {
      const rows = this.db.prepare("SELECT id FROM article_check_runs WHERE status = 'RUNNING'").all() as JsonMap[];
      if (!rows.length) return 0;
      const finishedAt = now();
      this.db
        .prepare(
          `UPDATE article_check_runs
          SET status = 'INTERRUPTED', error_code = 'APP_RESTARTED',
            error_message = 'The application stopped before the article check completed', finished_at = ?
          WHERE status = 'RUNNING'`,
        )
        .run(finishedAt);
      for (const row of rows) {
        this.storage.recordChange('ARTICLE_CHECK_RUN', text(row.id), 'INTERRUPT', {
          errorCode: 'APP_RESTARTED',
        });
      }
      return rows.length;
    })();
  }

  private get(id: string) {
    const row = this.db
      .prepare(`SELECT ${ARTICLE_CHECK_RUN_PROJECTION} FROM article_check_runs WHERE id = ?`)
      .get(id) as JsonMap | undefined;
    if (!row) throw new Error('Article check run is unavailable');
    return articleCheckRunDto(row);
  }

  private row(id: string) {
    const row = this.db.prepare('SELECT * FROM article_check_runs WHERE id = ?').get(id) as JsonMap | undefined;
    if (!row) throw new Error('Article check run is unavailable');
    return row;
  }
}
