import { randomUUID } from 'node:crypto';
import type { LibraryDatabase } from '@/main/database';
import { prepareDevelopmentHandoff } from '@/main/agent-cli/development-handoff';
import { developmentHandoffInputSchema } from '@/shared/contracts/development-handoff';
import { contentLinkUrl } from '@/shared/contracts/content-links';
import type { WorkItem, WorkMutation, WorkTask } from '@/shared/contracts/work-tracking';
import { WorkTrackingError } from '@/main/extensions/work-tracking/errors';

export class WorkTrackingSources {
  constructor(private readonly database: LibraryDatabase) {}

  spaceId() {
    return String(this.database.db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get());
  }

  article(creationItemId: string, descriptionFormId: string) {
    const item = this.database.getCreationItem({ creationItemId });
    const form = item?.forms.find((entry) => entry.id === descriptionFormId);
    if (!item || item.lifecycle !== 'ACTIVE' || form?.entity.kind !== 'ARTICLE')
      throw new WorkTrackingError('sourceUnavailable');
    const article = this.database.getArticle(form.entity.id);
    if (article.status !== 'ACTIVE') throw new WorkTrackingError('sourceUnavailable');
    return article;
  }

  batchArticles(input: Extract<WorkMutation, { action: 'trackBatch' }>) {
    // A single metadata query validates the fixed selection and current direct membership.
    // It reads no article bodies and rejects archived albums including archived ancestors.
    const rows = this.database.db
      .prepare(
        `
      WITH RECURSIVE lineage(id, archived_at) AS (
        SELECT id, archived_at FROM albums WHERE id = @albumId AND deleted_at IS NULL
        UNION
        SELECT parent.id, parent.archived_at FROM album_members member
        JOIN lineage child ON member.target_type = 'ALBUM' AND member.target_id = child.id
        JOIN albums parent ON parent.id = member.album_id AND parent.deleted_at IS NULL
        WHERE member.deleted_at IS NULL
      )
      SELECT item.id AS itemId, form.id AS formId, article.id AS articleId
      FROM json_each(@entries) selected
      JOIN creation_items item ON item.id = json_extract(selected.value, '$.creationItemId')
        AND item.archived_at IS NULL AND item.deleted_at IS NULL
      JOIN album_members member ON member.target_type = 'CREATION_ITEM' AND member.target_id = item.id
        AND member.album_id = @albumId AND member.deleted_at IS NULL
      JOIN creation_forms form ON form.id = json_extract(selected.value, '$.descriptionFormId')
        AND form.creation_item_id = item.id AND form.entity_type = 'ARTICLE' AND form.deleted_at IS NULL
      JOIN articles article ON article.id = form.entity_id AND article.status = 'ACTIVE' AND article.deleted_at IS NULL
      WHERE EXISTS (SELECT 1 FROM lineage) AND NOT EXISTS (SELECT 1 FROM lineage WHERE archived_at IS NOT NULL)
    `,
      )
      .all({ albumId: input.albumId, entries: JSON.stringify(input.entries) }) as {
      itemId: string;
      formId: string;
      articleId: string;
    }[];
    if (rows.length !== input.entries.length) throw new WorkTrackingError('sourceUnavailable');
    return new Map(rows.map((row) => [row.itemId, row.articleId]));
  }

  task(input: Extract<WorkMutation, { action: 'createTask' }>, items: WorkItem[]): WorkTask {
    const id = randomUUID();
    const time = new Date().toISOString();
    const documents = items.map((item) => {
      const article = this.article(item.id, item.descriptionFormId);
      return { item, article, document: this.database.contentLibrary.readCurrent({ kind: 'ARTICLE', id: article.id }) };
    });
    try {
      const packet = prepareDevelopmentHandoff(
        developmentHandoffInputSchema.parse({
          protocolVersion: 1,
          taskId: id,
          phase: input.phase,
          objective: input.objective,
          constraints: input.constraints ? [input.constraints] : [],
          sources: documents.map(({ item, document }, index) => ({
            id: `source-${index + 1}`,
            kind: item.kind === 'BUG' ? 'observation' : item.kind === 'RESEARCH' ? 'research' : 'requirement',
            title: document.title || item.id,
            locator: contentLinkUrl({ spaceId: input.spaceId, target: { kind: 'ARTICLE', id: document.source.id } }),
            revision: document.revisionId,
            status: 'selected',
            content: document.markdown || document.title,
          })),
          acceptance: documents.flatMap(({ item }, index) =>
            item.acceptance
              ? [{ id: `check-${index + 1}`, expectation: item.acceptance, sourceIds: [`source-${index + 1}`] }]
              : [],
          ),
        }),
      );
      return {
        id,
        objective: input.objective,
        executor: input.executor,
        phase: input.phase,
        packet,
        inputs: documents.map(({ item, article }) => ({
          itemId: item.id,
          itemRevision: item.revision,
          articleId: article.id,
          articleRevisionId: article.revisionId,
          title: article.content.title,
        })),
        createdAt: time,
        updatedAt: time,
      };
    } catch {
      throw new WorkTrackingError('limit');
    }
  }
}
