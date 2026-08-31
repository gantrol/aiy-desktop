import { ulid } from 'ulid';
import { z } from 'zod';
import type { ArticleContentInput } from '@/shared/contracts/article';
import type { LibraryStorage } from '@/main/database/core/storage';
import { now, text, type JsonMap } from '@/main/database/core/values';
import {
  ARTICLE_REVISION_PACK_CODEC,
  ARTICLE_REVISION_PACK_HOT_REVISIONS,
  ARTICLE_REVISION_PACK_IDLE_MS,
  ARTICLE_REVISION_PACK_MAX_COMPRESSED_BYTES,
  ARTICLE_REVISION_PACK_MAX_ENTRIES,
  ARTICLE_REVISION_PACK_MAX_SOURCE_BYTES,
  ARTICLE_REVISION_PACK_MIN_ENTRIES,
  ARTICLE_REVISION_PACK_MIN_SOURCE_BYTES,
  type ArticleRevisionContentLocator,
  type ArticleRevisionPackEntry,
  decodePackedArticleRevisionContent,
  encodeArticleRevisionPack,
  parseStandaloneArticleRevisionContent,
  parseVerifiedStandaloneArticleRevisionContent,
} from '@/main/database/creations/article-revision-pack-codec';

const candidateRowSchema = z
  .object({
    id: z.string().min(1),
    article_id: z.string().min(1),
    revision_no: z.number().int().positive(),
    content_json: z.string().min(1),
    content_hash: z.string().regex(/^[a-f0-9]{64}$/),
    source_bytes: z.number().int().positive().max(ARTICLE_REVISION_PACK_MAX_SOURCE_BYTES),
    eligible_count: z.number().int().positive().max(ARTICLE_REVISION_PACK_MAX_ENTRIES),
  })
  .strict();

interface PackCandidate {
  id: string;
  articleId: string;
  revisionNo: number;
  contentJson: string;
  contentHash: string;
  content: ArticleContentInput;
}

interface PackPlan {
  articleId: string;
  candidates: PackCandidate[];
  mayHaveMore: boolean;
}

export class ArticleRevisionPackStore {
  private acceptingSchedules = true;
  private started = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingArticleIds = new Set<string>();
  private running: Promise<void> | null = null;

  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  start() {
    if (!this.acceptingSchedules || this.started) return;
    this.started = true;
    this.armTimer();
  }

  schedule(articleId: string, revisionNo: number) {
    if (
      !this.acceptingSchedules ||
      revisionNo < ARTICLE_REVISION_PACK_HOT_REVISIONS + ARTICLE_REVISION_PACK_MIN_ENTRIES
    ) {
      return;
    }
    this.pendingArticleIds.add(articleId);
    if (!this.started || this.running) return;
    this.armTimer(true);
  }

  stopScheduling() {
    this.acceptingSchedules = false;
    this.started = false;
    this.pendingArticleIds.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async stopAndDrain() {
    this.stopScheduling();
    await this.running;
  }

  assertDrained() {
    if (this.running) throw new Error('Article revision packing must be drained before closing the database');
  }

  readContent(locator: ArticleRevisionContentLocator) {
    if (locator.packId === null && locator.packEntryIndex === null) {
      return parseStandaloneArticleRevisionContent(locator.contentJson);
    }
    if (
      locator.packId === null ||
      !Number.isSafeInteger(locator.packEntryIndex) ||
      (locator.packEntryIndex ?? -1) < 0 ||
      locator.contentJson !== ''
    ) {
      throw new Error('Stored article revision pack locator is invalid');
    }
    const row = this.db
      .prepare(
        `SELECT id, article_id, codec,
          CASE WHEN length(payload) BETWEEN 1 AND ? THEN payload ELSE NULL END AS payload,
          payload_hash, entry_count, first_revision_no, last_revision_no,
          uncompressed_bytes, compressed_bytes, created_at
        FROM article_revision_packs WHERE id = ?`,
      )
      .get(ARTICLE_REVISION_PACK_MAX_COMPRESSED_BYTES, locator.packId);
    if (!row) throw new Error('Stored article revision pack is unavailable');
    return decodePackedArticleRevisionContent(row, locator);
  }

  readContents(locators: readonly ArticleRevisionContentLocator[]) {
    const contents = new Map<string, ArticleContentInput>();
    const packed: ArticleRevisionContentLocator[] = [];
    const revisionIds = new Set<string>();
    for (const locator of locators) {
      if (revisionIds.has(locator.revisionId)) {
        throw new Error('Stored article revision identities must be unique');
      }
      revisionIds.add(locator.revisionId);
      if (locator.packId === null && locator.packEntryIndex === null) {
        contents.set(locator.revisionId, parseStandaloneArticleRevisionContent(locator.contentJson));
        continue;
      }
      if (
        locator.packId === null ||
        !Number.isSafeInteger(locator.packEntryIndex) ||
        (locator.packEntryIndex ?? -1) < 0 ||
        locator.contentJson !== ''
      ) {
        throw new Error('Stored article revision pack locator is invalid');
      }
      packed.push(locator);
    }
    const packIds = [...new Set(packed.map(({ packId }) => packId!))];
    const rowsByPackId = new Map<string, JsonMap>();
    for (let offset = 0; offset < packIds.length; offset += 400) {
      const chunk = packIds.slice(offset, offset + 400);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = this.db
        .prepare(
          `SELECT id, article_id, codec,
            CASE WHEN length(payload) BETWEEN 1 AND ? THEN payload ELSE NULL END AS payload,
            payload_hash, entry_count, first_revision_no, last_revision_no,
            uncompressed_bytes, compressed_bytes, created_at
          FROM article_revision_packs WHERE id IN (${placeholders})`,
        )
        .all(ARTICLE_REVISION_PACK_MAX_COMPRESSED_BYTES, ...chunk) as JsonMap[];
      for (const row of rows) rowsByPackId.set(text(row.id), row);
    }
    for (const locator of packed) {
      const row = rowsByPackId.get(locator.packId!);
      if (!row) throw new Error('Stored article revision pack is unavailable');
      contents.set(locator.revisionId, decodePackedArticleRevisionContent(row, locator));
    }
    return contents;
  }

  private armTimer(reset = false) {
    if (!this.started || this.running || this.pendingArticleIds.size === 0) return;
    if (this.timer) {
      if (!reset) return;
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.runNext();
    }, ARTICLE_REVISION_PACK_IDLE_MS);
    this.timer.unref?.();
  }

  private runNext() {
    if (!this.started || this.running) return;
    const articleId = this.pendingArticleIds.values().next().value as string | undefined;
    if (!articleId) return;
    this.pendingArticleIds.delete(articleId);
    const operation = this.compactOneBatch(articleId)
      .then((mayHaveMore) => {
        if (mayHaveMore && this.started) this.pendingArticleIds.add(articleId);
      })
      .catch((error) => console.error('[article-revision-pack] compaction failed', error))
      .finally(() => {
        if (this.running === operation) this.running = null;
        this.armTimer();
      });
    this.running = operation;
  }

  private async compactOneBatch(articleId: string) {
    const plan = this.capturePlan(articleId);
    if (!plan) return false;
    const encoded = await encodeArticleRevisionPack({
      schemaVersion: 1,
      articleId: plan.articleId,
      entries: plan.candidates.map(
        (candidate) =>
          ({
            revisionId: candidate.id,
            revisionNo: candidate.revisionNo,
            contentHash: candidate.contentHash,
            content: candidate.content,
          }) satisfies ArticleRevisionPackEntry,
      ),
    });
    this.commitPlan(plan, encoded);
    return plan.mayHaveMore;
  }

  private capturePlan(articleId: string): PackPlan | null {
    const rows = z.array(candidateRowSchema).parse(
      this.db
        .prepare(
          `WITH eligible AS (
            SELECT revision.id, revision.article_id, revision.revision_no,
              revision.content_json, revision.content_hash,
              length(CAST(revision.content_json AS BLOB)) AS source_bytes
            FROM article_revisions revision
            JOIN articles article ON article.id = revision.article_id
            WHERE revision.article_id = ?
              AND article.deleted_at IS NULL
              AND revision.content_pack_id IS NULL
              AND revision.content_pack_entry_index IS NULL
              AND revision.id <> article.current_revision_id
              AND revision.revision_no <= (
                SELECT COALESCE(MAX(newest.revision_no), 0) - ?
                FROM article_revisions newest
                WHERE newest.article_id = revision.article_id
              )
              AND length(CAST(revision.content_json AS BLOB)) BETWEEN 1 AND ?
            ORDER BY revision.revision_no ASC
            LIMIT ?
          ), bounded AS (
            SELECT eligible.*,
              SUM(source_bytes) OVER (ORDER BY revision_no ASC) AS cumulative_bytes,
              COUNT(*) OVER () AS eligible_count
            FROM eligible
          )
          SELECT id, article_id, revision_no, content_json, content_hash, source_bytes, eligible_count
          FROM bounded
          WHERE cumulative_bytes <= ?
          ORDER BY revision_no ASC`,
        )
        .all(
          articleId,
          ARTICLE_REVISION_PACK_HOT_REVISIONS,
          ARTICLE_REVISION_PACK_MAX_SOURCE_BYTES,
          ARTICLE_REVISION_PACK_MAX_ENTRIES,
          ARTICLE_REVISION_PACK_MAX_SOURCE_BYTES,
        ),
    );
    const candidates = rows.map((row): PackCandidate => ({
      id: row.id,
      articleId: row.article_id,
      revisionNo: row.revision_no,
      contentJson: row.content_json,
      contentHash: row.content_hash,
      content: parseVerifiedStandaloneArticleRevisionContent(row.content_json, row.content_hash),
    }));
    const sourceBytes = rows.reduce((total, row) => total + row.source_bytes, 0);
    if (candidates.length < ARTICLE_REVISION_PACK_MIN_ENTRIES || sourceBytes < ARTICLE_REVISION_PACK_MIN_SOURCE_BYTES) {
      return null;
    }
    return {
      articleId,
      candidates,
      mayHaveMore:
        rows.length > 0 &&
        (rows[0]!.eligible_count === ARTICLE_REVISION_PACK_MAX_ENTRIES || rows.length < rows[0]!.eligible_count),
    };
  }

  private commitPlan(plan: PackPlan, encoded: Awaited<ReturnType<typeof encodeArticleRevisionPack>>) {
    const packId = ulid();
    const firstRevisionNo = plan.candidates[0]?.revisionNo;
    const lastRevisionNo = plan.candidates.at(-1)?.revisionNo;
    if (!firstRevisionNo || !lastRevisionNo) throw new Error('Article revision pack plan is empty');
    this.db
      .transaction(() => {
        this.db
          .prepare(
            `INSERT INTO article_revision_packs
            (id, article_id, codec, payload, payload_hash, entry_count,
              first_revision_no, last_revision_no, uncompressed_bytes, compressed_bytes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            packId,
            plan.articleId,
            ARTICLE_REVISION_PACK_CODEC,
            encoded.payload,
            encoded.payloadHash,
            plan.candidates.length,
            firstRevisionNo,
            lastRevisionNo,
            encoded.uncompressedBytes,
            encoded.compressedBytes,
            now(),
          );
        const update = this.db.prepare(
          `UPDATE article_revisions
          SET content_json = '', content_pack_id = ?, content_pack_entry_index = ?
          WHERE id = ? AND article_id = ? AND revision_no = ?
            AND content_hash = ? AND content_json = ?
            AND content_pack_id IS NULL AND content_pack_entry_index IS NULL
            AND id <> (SELECT current_revision_id FROM articles WHERE id = ?)
            AND EXISTS (SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NULL)`,
        );
        plan.candidates.forEach((candidate, index) => {
          const result = update.run(
            packId,
            index,
            candidate.id,
            candidate.articleId,
            candidate.revisionNo,
            candidate.contentHash,
            candidate.contentJson,
            plan.articleId,
            plan.articleId,
          );
          if (result.changes !== 1) throw new Error('Article revision changed while committing a pack');
        });
      })
      .immediate();
  }
}
