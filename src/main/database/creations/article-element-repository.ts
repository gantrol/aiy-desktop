import { articleElementPlacementSchema, type ArticleElementPlacementInput } from '@/shared/contracts/article';
import type { LibraryStorage } from '@/main/database/core/storage';
import { type JsonMap, text } from '@/main/database/core/values';

function placementDto(row: JsonMap): ArticleElementPlacementInput {
  return articleElementPlacementSchema.parse({
    elementId: text(row.element_id),
    blockIndex: Number(row.block_index),
    nodeType: text(row.node_type),
    textFingerprint: text(row.text_fingerprint),
    preview: text(row.preview),
  });
}

export class ArticleElementRepository {
  constructor(private readonly storage: LibraryStorage) {}

  private get db() {
    return this.storage.db;
  }

  listPlacements(revisionId: string): ArticleElementPlacementInput[] {
    return (
      this.db
        .prepare(
          `SELECT element_id, block_index, node_type, text_fingerprint, preview
          FROM article_revision_elements
          WHERE revision_id = ?
          ORDER BY block_index, element_id`,
        )
        .all(revisionId) as JsonMap[]
    ).map(placementDto);
  }

  listPlacementsMany(revisionIds: readonly string[]) {
    const placementsByRevision = new Map<string, ArticleElementPlacementInput[]>(
      revisionIds.map((revisionId) => [revisionId, []]),
    );
    const uniqueRevisionIds = [...placementsByRevision.keys()];
    for (let offset = 0; offset < uniqueRevisionIds.length; offset += 400) {
      const chunk = uniqueRevisionIds.slice(offset, offset + 400);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = this.db
        .prepare(
          `SELECT revision_id, element_id, block_index, node_type, text_fingerprint, preview
          FROM article_revision_elements
          WHERE revision_id IN (${placeholders})
          ORDER BY revision_id, block_index, element_id`,
        )
        .all(...chunk) as JsonMap[];
      for (const row of rows) placementsByRevision.get(text(row.revision_id))!.push(placementDto(row));
    }
    return placementsByRevision;
  }

  savePlacements(
    articleId: string,
    revisionId: string,
    rawPlacements: readonly ArticleElementPlacementInput[],
    timestamp: string,
  ) {
    const placements = rawPlacements.map((placement) => articleElementPlacementSchema.parse(placement));
    if (new Set(placements.map((placement) => placement.elementId)).size !== placements.length) {
      throw new Error('Article element identities must be unique within a revision');
    }
    if (new Set(placements.map((placement) => placement.blockIndex)).size !== placements.length) {
      throw new Error('Article element positions must be unique within a revision');
    }
    this.assertRevision(articleId, revisionId);
    for (const placement of placements) {
      this.ensureElement(articleId, placement.elementId, timestamp);
      this.insertPlacement(articleId, revisionId, placement);
    }
  }

  copyPlacements(articleId: string, sourceRevisionId: string, targetRevisionId: string, timestamp: string) {
    this.assertRevision(articleId, sourceRevisionId);
    this.assertRevision(articleId, targetRevisionId);
    const placements = this.listPlacements(sourceRevisionId);
    this.savePlacements(articleId, targetRevisionId, placements, timestamp);
  }

  private assertRevision(articleId: string, revisionId: string) {
    const row = this.db
      .prepare('SELECT 1 FROM article_revisions WHERE id = ? AND article_id = ?')
      .get(revisionId, articleId);
    if (!row) throw new Error('Article element revision identity is invalid');
  }

  private ensureElement(articleId: string, elementId: string, timestamp: string) {
    this.db
      .prepare(
        `INSERT INTO article_elements(id, article_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`,
      )
      .run(elementId, articleId, timestamp, timestamp);
    const existing = this.db.prepare('SELECT article_id FROM article_elements WHERE id = ?').get(elementId) as
      JsonMap | undefined;
    if (!existing || text(existing.article_id) !== articleId) {
      throw new Error('Article element identity belongs to another article');
    }
    this.db.prepare('UPDATE article_elements SET updated_at = ? WHERE id = ?').run(timestamp, elementId);
  }

  private insertPlacement(articleId: string, revisionId: string, placement: ArticleElementPlacementInput) {
    this.db
      .prepare(
        `INSERT INTO article_revision_elements
        (revision_id, article_id, element_id, block_index, node_type, text_fingerprint, preview)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        revisionId,
        articleId,
        placement.elementId,
        placement.blockIndex,
        placement.nodeType,
        placement.textFingerprint,
        placement.preview,
      );
  }
}
