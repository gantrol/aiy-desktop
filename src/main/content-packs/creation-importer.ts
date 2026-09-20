import type { LibraryStorage } from '@/main/database/core/storage';
import type { AlbumRepository } from '@/main/database/albums/album-repository';
import type { ArticleRepository } from '@/main/database/creations/article-repository';
import type { CreationItemRepository } from '@/main/database/creations/creation-item-repository';
import type { PreparedContentPackCreations } from '@/main/content-packs/creation-source';
import type { FixturePackSupplementalItem } from '@/main/database/packs/fixture-pack-source';

/** Called inside the content pack's transaction; installation owns the revision selection. */
export function stageContentPackCreations(
  storage: LibraryStorage,
  prepared: PreparedContentPackCreations,
  albums: AlbumRepository,
  articles: ArticleRepository,
  items: CreationItemRepository,
): FixturePackSupplementalItem[] {
  const { layout } = prepared;
  const existing = storage.db.prepare('SELECT 1 FROM albums WHERE id = ?').get(layout.albumId);
  const revisions = new Map<string, string>();
  if (existing) {
    for (const work of prepared.works) revisions.set(work.id, articles.stageContentPackRevision(work.id, work.content));
  } else {
    albums.create(
      { title: layout.title, titleLocale: layout.titleLocale, intent: layout.description },
      { id: layout.albumId },
    );
    const works = new Map(prepared.works.map((work) => [work.id, work]));
    for (const group of layout.groups) {
      for (const [index, workId] of group.workIds.entries()) {
        const work = works.get(workId)!;
        const article = articles.save(
          {
            id: null,
            albumId: layout.albumId,
            sourceInspirationStashId: null,
            consumeCreationDraftId: null,
            content: work.content,
          },
          {
            requestId: work.id,
            ...(index === 0 ? { newCreationItemId: group.id } : { creationItemId: group.id }),
          },
        );
        revisions.set(work.id, article.revisionId);
      }
      const item = items.get(group.id);
      const primary = item.forms.find(
        (form) => form.entity.kind === 'ARTICLE' && form.entity.id === group.primaryWorkId,
      );
      if (!primary) throw new Error('CONTENT_PACK_PRIMARY_WORK_MISSING');
      if (item.primaryFormId !== primary.id) items.setPrimary({ creationItemId: item.id, formId: primary.id });
    }
  }
  return prepared.items.map((item) =>
    item.objectType === 'ARTICLE_REVISION' ? { ...item, localRevisionId: revisions.get(item.localObjectId)! } : item,
  );
}
