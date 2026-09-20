import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { ContentLibraryRepository } from '@/main/database/creations/content-library-repository';
import { referenceMetadata } from '@/main/database/creations/content-reference-metadata';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import { contentOutline, contentOutlineRows, selectContentBlock } from '@/shared/content-outline';
import { contentAssetPath } from '@/shared/content-document';
import { contentMarkdownMediaPaths, contentMarkdownReferences, replaceMarkdownMedia } from '@/shared/content-markdown';
import {
  contentReferenceSchema,
  referencePreviewSchema,
  type ContentDocument,
  type ContentLibraryCommand,
  type ReferencePreview,
} from '@/shared/contracts/content-library';
import { isDocumentSource, type ReferenceSource, type ReferenceTarget } from '@/shared/contracts/content-source';
import { blockDocumentSchema, type BlockNode } from '@/shared/contracts/block-document';

const fingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const escape = (text: string) => text.replace(/[\\`*_[\]<>#]/gu, '\\$&').replace(/[\r\n]/gu, ' ');
const MEMBER_LIMIT = 200;
type Member = { membershipId: string; kind: string; id: string; title: string; revisionId?: string };

/** Fixed snapshots share the existing reference store; collections never become editable documents. */
export class ContentReferenceTargets {
  constructor(
    private readonly repositories: LibraryDatabaseRepositories,
    private readonly content: ContentLibraryRepository,
  ) {}
  private get db() {
    return this.repositories.db;
  }
  /** Resolve a current editing location atomically. Historical previews never authorize a guessed current location. */
  open(target: ReferenceTarget, referenceId?: string) {
    if (!['ARTICLE', 'INSPIRATION_STASH'].includes(target.source.kind))
      throw new Error('REFERENCE_NAVIGATION_UNSUPPORTED');
    return this.db.transaction(() => {
      const articleId = target.source.id;
      const owner = this.db
        .prepare(
          `SELECT item.id FROM creation_forms form
        JOIN creation_items item ON item.id = form.creation_item_id
        JOIN articles article ON article.id = form.entity_id
        JOIN article_revisions revision ON revision.id = article.current_revision_id AND revision.article_id = article.id
        WHERE form.entity_type = 'ARTICLE' AND form.entity_id = ? AND form.deleted_at IS NULL
          AND article.status = 'ACTIVE' AND article.deleted_at IS NULL
          AND item.deleted_at IS NULL AND item.archived_at IS NULL`,
        )
        .get(articleId) as { id: string } | undefined;
      if (!owner) throw new Error('REFERENCE_SOURCE_UNAVAILABLE');
      const albums = this.db
        .prepare(
          "SELECT album_id FROM album_members WHERE target_type='CREATION_ITEM' AND target_id=? AND deleted_at IS NULL",
        )
        .all(owner.id) as { album_id: string }[];
      for (const album of albums) {
        try {
          this.repositories.albums.assertAlbumAcceptsContent(album.album_id);
        } catch (cause) {
          throw new Error('REFERENCE_SOURCE_UNAVAILABLE', { cause });
        }
      }
      const article = this.repositories.articles.get(articleId);
      const matches: BlockNode[] = [];
      const visit = (node: BlockNode) => {
        if (
          target.blockId
            ? node.attrs?.blockId === target.blockId
            : referenceId && node.type === 'contentReference' && node.attrs?.referenceId === referenceId
        )
          matches.push(node);
        node.content?.forEach(visit);
      };
      if (article.content.document) visit(article.content.document.root);
      if (target.blockId || referenceId) {
        if (matches.length > 1) throw new Error('BLOCK_ID_AMBIGUOUS');
        if (!matches.length) throw new Error(referenceId ? 'REFERENCE_USE_CHANGED' : 'REFERENCE_LOCATION_MISSING');
        if (typeof matches[0].attrs?.blockId !== 'string' || !matches[0].attrs.blockId)
          throw new Error('REFERENCE_LOCATION_MISSING');
        if (referenceId && (matches[0].type !== 'contentReference' || matches[0].attrs?.referenceId !== referenceId))
          throw new Error('REFERENCE_USE_CHANGED');
      }
      return {
        spaceId: String(this.db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get()),
        article,
        blockId: matches.length ? String(matches[0].attrs!.blockId) : null,
      };
    })();
  }
  private collection(source: Exclude<ReferenceSource, import('@/shared/contracts/content-source').ContentSource>) {
    if (source.kind === 'CREATION_ITEM') {
      const item = this.repositories.creationItems.get(source.id);
      const available = this.db
        .prepare('SELECT 1 FROM creation_items WHERE id=? AND deleted_at IS NULL AND archived_at IS NULL')
        .get(source.id);
      if (!available) throw new Error('REFERENCE_SOURCE_UNAVAILABLE');
      const owners = this.db
        .prepare(
          "SELECT album_id FROM album_members WHERE target_type='CREATION_ITEM' AND target_id=? AND deleted_at IS NULL",
        )
        .all(source.id) as { album_id: string }[];
      for (const owner of owners) this.repositories.albums.assertAlbumAcceptsContent(owner.album_id);
      if (item.forms.length > MEMBER_LIMIT) throw new Error('REFERENCE_MEMBERS_LIMIT');
      const describe = referenceMetadata(
        this.db,
        item.forms.map((form) => form.entity),
      );
      const members = [...item.forms]
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
        .map((form): Member => ({
          membershipId: form.id,
          kind: form.entity.kind,
          id: form.entity.id,
          ...describe(form.entity),
        }));
      const primary = members.find((member) => member.membershipId === item.primaryFormId);
      return { title: primary?.title || members[0]?.title || `CREATION_ITEM · ${source.id}`, members };
    }
    this.repositories.albums.assertAlbumAcceptsContent(source.id);
    const rows = this.db
      .prepare(
        'SELECT id, target_type, target_id FROM album_members WHERE album_id=? AND deleted_at IS NULL ORDER BY sort_order,id LIMIT ?',
      )
      .all(source.id, MEMBER_LIMIT + 1) as { id: string; target_type: string; target_id: string }[];
    if (rows.length > MEMBER_LIMIT) throw new Error('REFERENCE_MEMBERS_LIMIT');
    const describe = referenceMetadata(this.db, [
      source,
      ...rows.map((row) => ({ kind: row.target_type, id: row.target_id })),
    ]);
    const members = rows.map((row): Member => ({
      membershipId: row.id,
      kind: row.target_type,
      id: row.target_id,
      ...describe({ kind: row.target_type, id: row.target_id }),
    }));
    return { title: describe(source).title, members };
  }
  inspect(target: ReferenceTarget): ReferencePreview {
    if (!isDocumentSource(target.source)) {
      const { title, members } = this.collection(target.source);
      const version = fingerprint({ source: target.source, title, members });
      return referencePreviewSchema.parse({
        target,
        title,
        version,
        revisionId: `members:${version}`,
        markdown: `# ${escape(title)}\n\n${members.map((member, index) => `${index + 1}. ${escape(member.title)} — ${member.kind} (${member.id})`).join('\n')}`,
        media: [],
        blocks: [],
        selector: { kind: 'MEMBERS', members },
      });
    }
    const document = this.content.read(target.source);
    let markdown = document.markdown;
    let blocks: ReferencePreview['blocks'] = [];
    let selector: ReferencePreview['selector'];
    let persisted: unknown;
    if (document.source.kind === 'ARTICLE') {
      persisted = this.repositories.articles.getRevision({
        articleId: document.source.id,
        revisionId: document.revisionId,
      }).content;
    } else if (document.source.kind === 'SOCIAL_POST') {
      persisted = this.repositories.socialPosts.getRevision(document.source.id, document.revisionId).content;
    } else if (document.source.kind === 'VIDEO_DOCUMENT' && document.source.branchId) {
      const revision = this.repositories.videoDocuments.getRevision(document.source.branchId, document.revisionId);
      if (revision?.content.format === 'NOTE_COLLECTION') {
        persisted = document.source.noteId
          ? revision.content.notes.find((note) => note.id === document.source.noteId)
          : undefined;
      } else persisted = revision?.content;
    }
    const parsed = blockDocumentSchema.safeParse(
      persisted && typeof persisted === 'object' && 'document' in persisted ? persisted.document : undefined,
    );
    if (parsed.success) {
      blocks = contentOutlineRows(contentOutline(parsed.data.root), null, new Set()).flatMap(({ node, depth }) =>
        node.blockId ? [{ id: node.blockId, title: node.title, kind: node.kind, depth }] : [],
      );
      if (target.blockId) {
        markdown = blockDocumentMarkdown(
          selectContentBlock(
            parsed.data,
            target.blockId,
            target.section === true,
            target.scope,
            Boolean(
              persisted &&
              typeof persisted === 'object' &&
              'editorMode' in persisted &&
              persisted.editorMode === 'OUTLINE',
            ),
          ),
          document.media,
        );
        selector = {
          kind: 'BLOCK',
          blockId: target.blockId,
          section: target.scope ? target.scope === 'SECTION' : target.section === true,
          ...(target.scope ? { scope: target.scope } : {}),
        };
      }
    } else if (target.blockId) throw new Error('BLOCK_ID_UNAVAILABLE');
    // A current-source preview stays current for capture validation; explicit historical targets stay pinned.
    const canonical = { ...target, source: { ...document.source, revisionId: target.source.revisionId } };
    return referencePreviewSchema.parse({
      target: canonical,
      title: document.displayTitle,
      revisionId: document.revisionId,
      version: fingerprint({
        target: canonical,
        revisionId: document.revisionId,
        markdown,
        media: document.media.map(({ assetId, path }) => ({ assetId, path })),
      }),
      markdown,
      media: document.media,
      blocks,
      selector,
    });
  }
  capture(target: ReferenceTarget, expectedVersion: string) {
    return this.db.transaction(() => {
      const preview = this.inspect(target);
      if (preview.version !== expectedVersion) throw new Error('REFERENCE_TARGET_CHANGED');
      const expanded = this.content.render(preview.markdown);
      const media = [...preview.media, ...expanded.media];
      const markdown = replaceMarkdownMedia(
        expanded.markdown,
        new Map(media.map((asset) => [asset.path, contentAssetPath(asset.assetId)])),
      );
      const paths = contentMarkdownMediaPaths(markdown);
      const retained = [
        ...new Map(
          media
            .filter((asset) => paths.has(contentAssetPath(asset.assetId)))
            .map((asset) => [asset.assetId, { ...asset, path: contentAssetPath(asset.assetId) }]),
        ).values(),
      ];
      const reference = contentReferenceSchema.parse({
        id: ulid(),
        source: isDocumentSource(preview.target.source)
          ? { ...preview.target.source, revisionId: preview.revisionId }
          : preview.target.source,
        title: preview.title,
        revisionId: preview.revisionId,
        contentHash: createHash('sha256').update(markdown).digest('hex'),
        markdown,
        media: retained,
        start: 0,
        end: markdown.length,
        createdAt: new Date().toISOString(),
        selector: preview.selector,
      });
      this.db
        .prepare(
          'INSERT INTO content_block_references(id, source_kind, source_id, revision_id, snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          reference.id,
          reference.source.kind,
          reference.source.id,
          reference.revisionId,
          JSON.stringify(reference),
          reference.createdAt,
        );
      const insert = this.db.prepare('INSERT INTO content_block_assets(reference_id, asset_id) VALUES (?, ?)');
      for (const asset of reference.media) insert.run(reference.id, asset.assetId);
      return reference;
    })();
  }
  search(command: Extract<ContentLibraryCommand, { kind: 'reference-search' }>) {
    if (command.category === 'CONTENT') {
      const result = this.content.search(command.query, command.offset);
      return {
        ...result,
        items: result.items.map(({ source, ...item }) => ({
          ...item,
          target: { source: { ...source, revisionId: undefined } },
        })),
      };
    }
    const table = command.category === 'ALBUM' ? 'albums' : 'creation_items';
    const rows = this.db
      .prepare(
        `SELECT id FROM ${table} WHERE deleted_at IS NULL AND archived_at IS NULL ORDER BY updated_at DESC,id LIMIT 41 OFFSET ?`,
      )
      .all(command.offset) as { id: string }[];
    const needle = command.query.trim().toLocaleLowerCase();
    const describe = referenceMetadata(
      this.db,
      rows.slice(0, 40).map(({ id }) => ({ kind: command.category, id })),
    );
    const items = rows.slice(0, 40).flatMap(({ id }) => {
      const target: ReferenceTarget = { source: { kind: command.category as 'ALBUM' | 'CREATION_ITEM', id } };
      const { title } = describe(target.source);
      return !needle || title.toLocaleLowerCase().includes(needle) ? [{ target, title, preview: '' }] : [];
    });
    return { items, nextOffset: rows.length > 40 ? command.offset + 40 : null };
  }
  /** Read actual saved use sites, not unused captures. Pagination is explicit and article-scoped. */
  uses(target: ReferenceTarget, offset: number) {
    const kind = target.source.kind === 'INSPIRATION_STASH' ? 'ARTICLE' : target.source.kind;
    const rows = this.db
      .prepare(
        "SELECT id FROM content_block_references WHERE source_kind=? AND source_id=? AND coalesce(json_extract(snapshot_json,'$.source.branchId'),'')=? AND coalesce(json_extract(snapshot_json,'$.source.noteId'),'')=? AND (? IS NULL OR json_extract(snapshot_json,'$.selector.blockId')=?) LIMIT 10001",
      )
      .all(
        kind,
        target.source.id,
        isDocumentSource(target.source) ? (target.source.branchId ?? '') : '',
        isDocumentSource(target.source) ? (target.source.noteId ?? '') : '',
        target.blockId ?? null,
        target.blockId ?? null,
      ) as { id: string }[];
    if (rows.length > 10000) throw new Error('REFERENCE_USES_LIMIT');
    const references = new Set(rows.map((row) => row.id));
    const consumers = this.db
      .prepare(
        "SELECT id FROM articles WHERE deleted_at IS NULL AND status='ACTIVE' ORDER BY updated_at DESC,id LIMIT 41 OFFSET ?",
      )
      .all(offset) as { id: string }[];
    const uses: { source: ContentDocument['source']; title: string; blockId: string | null; referenceId: string }[] =
      [];
    for (const consumer of consumers.slice(0, 40)) {
      const article = this.repositories.articles.get(consumer.id);
      const source = { kind: 'ARTICLE' as const, id: article.id, revisionId: article.revisionId };
      const add = (id: string, blockId: string | null) => {
        if (references.has(id)) uses.push({ source, title: article.content.title, blockId, referenceId: id });
      };
      if (article.content.document) {
        const visit = (node: BlockNode) => {
          if (node.type === 'contentReference' && typeof node.attrs?.referenceId === 'string')
            add(node.attrs.referenceId, typeof node.attrs.blockId === 'string' ? node.attrs.blockId : null);
          node.content?.forEach(visit);
        };
        visit(article.content.document.root);
      } else for (const reference of contentMarkdownReferences(article.content.markdown)) add(reference.id, null);
    }
    if (uses.length > 1000) throw new Error('REFERENCE_USES_LIMIT');
    return { scope: 'CURRENT_ARTICLES' as const, items: uses, nextOffset: consumers.length > 40 ? offset + 40 : null };
  }
}
