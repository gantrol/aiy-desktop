import { createHash } from 'node:crypto';
import { plainTextBlockDocument } from '@/shared/block-document-codecs';
import { createOutlineDocument } from '@/shared/outline-document';
import { contentLinkUrl } from '@/shared/contracts/content-links';
import type { CreationOrganizationCommand, CreationOrganizationResult } from '@/shared/contracts/creation-organization';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';

export function createCreationOrganizationApi(repositories: LibraryDatabaseRepositories) {
  const { db, albums, articles, creationItems } = repositories;
  return {
    creationOrganizationCommand(input: CreationOrganizationCommand): CreationOrganizationResult {
      try {
        return db
          .transaction((): CreationOrganizationResult => {
            if (db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get() !== input.spaceId)
              return { kind: 'error', code: 'CHANGED' };
            const link = (id: string) => {
              const article = articles.get(id);
              const target = { kind: 'ARTICLE' as const, id };
              return {
                kind: 'opened' as const,
                link: {
                  spaceId: input.spaceId,
                  target,
                  title: article.content.title,
                  url: contentLinkUrl({ spaceId: input.spaceId, target }),
                },
              };
            };
            const parent = input.kind === 'create-child' ? creationItems.get(input.parentCreationItemId) : null;
            if (parent?.lifecycle === 'ARCHIVED') return { kind: 'error', code: 'UNAVAILABLE' };
            const albumId = input.kind === 'album-note' ? input.albumId : parent!.albumId;
            if (albumId) albums.assertAlbumAcceptsContent(albumId);
            if (input.kind === 'album-note') {
              const existing = db
                .prepare(
                  `SELECT article.id, article.status, item.archived_at FROM album_notes note
              JOIN articles article ON article.id = note.article_id
              JOIN creation_forms form ON form.entity_type = 'ARTICLE' AND form.entity_id = article.id AND form.deleted_at IS NULL
              JOIN creation_items item ON item.id = form.creation_item_id AND item.deleted_at IS NULL
              WHERE note.album_id = ? AND article.deleted_at IS NULL`,
                )
                .get(input.albumId) as { id: string; status: string; archived_at: string | null } | undefined;
              if (existing)
                return existing.archived_at || existing.status !== 'ACTIVE'
                  ? { kind: 'error', code: 'UNAVAILABLE' }
                  : link(existing.id);
            }
            const prefix = input.kind === 'create-child' ? `creation-child:${input.requestId}:` : null;
            const requestId = prefix
              ? prefix + createHash('sha256').update(JSON.stringify(input)).digest('hex')
              : undefined;
            if (prefix) {
              const prior = db
                .prepare('SELECT id, deleted_at FROM articles WHERE id >= ? AND id < ? LIMIT 2')
                .all(prefix, prefix + '~') as { id: string; deleted_at: string | null }[];
              if (prior.length) {
                if (prior.length !== 1 || prior[0].id !== requestId || prior[0].deleted_at)
                  return { kind: 'error', code: 'CHANGED' };
                return link(prior[0].id);
              }
            }
            const outline = input.kind === 'create-child' && input.format === 'OUTLINE';
            const document = plainTextBlockDocument('');
            const article = articles.save(
              {
                id: null,
                albumId,
                sourceInspirationStashId: null,
                consumeCreationDraftId: null,
                content: {
                  schemaVersion: 2,
                  title: input.title,
                  markdown: '',
                  document: outline ? createOutlineDocument(document) : document,
                  ...(outline ? { editorMode: 'OUTLINE' as const } : {}),
                  mediaBindings: [],
                  coverAssetId: null,
                },
              },
              requestId ? { requestId } : undefined,
            );
            if (input.kind === 'create-child') {
              const item = creationItems.findForEntity({ kind: 'ARTICLE', id: article.id });
              if (!item) throw new Error('Creation registration missing');
              creationItems.move({
                creationItemId: item.id,
                albumId,
                parentCreationItemId: input.parentCreationItemId,
              });
            } else {
              db.prepare(
                `INSERT INTO album_notes(album_id, article_id) VALUES (?, ?)
              ON CONFLICT(album_id) DO UPDATE SET article_id = excluded.article_id`,
              ).run(input.albumId, article.id);
              repositories.storage.recordChange('ALBUM', input.albumId, 'SET_NOTE', { articleId: article.id });
            }
            return link(article.id);
          })
          .immediate();
      } catch {
        return { kind: 'error', code: 'FAILED' };
      }
    },
  };
}
