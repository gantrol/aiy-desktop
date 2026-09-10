import { mediaUrl, now } from '@/main/database/core/values';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import {
  contentAssetPath,
  contentDisplayTitle,
  plainTextMarkdown,
  replaceContentPromptText,
} from '@/shared/content-document';
import {
  contentMarkdownBlocks,
  contentMarkdownMediaPaths,
  contentMarkdownRange,
  contentMarkdownReferences,
  replaceMarkdownMedia,
} from '@/shared/content-markdown';
import { ContentReadError } from '@/shared/content-read-error';
import type { ArticleContentInput, VideoDocumentMediaBinding, VideoDocumentRevisionDto } from '@/shared/contracts';
import {
  contentDocumentSchema,
  contentReferenceSchema,
  type ContentDocument,
  type ContentLibraryCommand,
  type ContentReference,
  type ContentSource,
} from '@/shared/contracts/content-library';
import {
  desktopNoteDraftSchema,
  desktopNoteSchema,
  type DesktopNoteDraft,
  type DesktopNoteSave,
} from '@/shared/contracts/desktop-petals';
import { inspirationStashContentSchema } from '@/shared/contracts/inspiration-stash';
import { videoDocumentRevisionMediaSchema } from '@/shared/contracts/video-document';
import { createHash } from 'node:crypto';
import { ulid } from 'ulid';

type Repositories = Pick<
  LibraryDatabaseRepositories,
  'storage' | 'articles' | 'socialPosts' | 'videoDocuments' | 'inspirationStashes'
>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type ContentBody = { title: string; revisionId: string; markdown: string; media: ContentDocument['media'] };

export class ContentLibraryRepository {
  constructor(private readonly repositories: Repositories) {}
  private get db() {
    return this.repositories.storage.db;
  }

  read(source: ContentSource): ContentDocument {
    let body: ContentBody;
    if (source.kind === 'ARTICLE') {
      const article = source.revisionId
        ? this.repositories.articles.getRevision({ articleId: source.id, revisionId: source.revisionId })
        : this.repositories.articles.get(source.id);
      body = {
        title: article.content.title,
        revisionId: article.revisionId,
        markdown: article.content.markdown,
        media: article.content.mediaBindings.flatMap((binding) => {
          const asset = article.content.mediaAssets.find((asset) => asset.id === binding.assetId);
          return asset
            ? [
                {
                  ...binding,
                  mediaUrl: asset.mediaUrl,
                  mimeType: asset.mimeType,
                  width: asset.width,
                  height: asset.height,
                  byteSize: asset.byteSize ?? 0,
                },
              ]
            : [];
        }),
      };
    } else if (source.kind === 'SOCIAL_POST') {
      const post = source.revisionId
        ? this.repositories.socialPosts.getRevision(source.id, source.revisionId)
        : this.repositories.socialPosts.get(source.id);
      body = {
        title: post.content.title,
        revisionId: post.revisionId,
        markdown: post.content.format === 'markdown' ? post.content.body : plainTextMarkdown(post.content.body),
        media: this.media(post.content.mediaAssetIds),
      };
    } else if (source.kind === 'INSPIRATION_STASH') {
      const stash = this.repositories.inspirationStashes.get(source.id);
      const revision = this.db
        .prepare(
          `SELECT id, content_json FROM inspiration_stash_revisions WHERE stash_id = ? ${source.revisionId ? 'AND id = ?' : ''} ORDER BY revision_no DESC LIMIT 1`,
        )
        .get(source.id, ...(source.revisionId ? [source.revisionId] : [])) as
        { id: string; content_json: string } | undefined;
      if (source.revisionId && !revision && source.revisionId !== stash.contentHash)
        throw new ContentReadError('REVISION_UNAVAILABLE', source, stash.contentHash);
      const content = revision ? inspirationStashContentSchema.parse(JSON.parse(revision.content_json)) : stash.content;
      body = {
        title: content.title ?? '',
        revisionId: revision?.id ?? stash.contentHash,
        markdown: content.format === 'markdown' ? content.manualPrompt : plainTextMarkdown(content.manualPrompt),
        media: this.media(content.referenceAssetIds),
      };
    } else {
      const document = this.repositories.videoDocuments.get(source.id);
      const populated = document.branches.filter((branch) => branch.latestDraftRevisionId);
      const branch = source.branchId
        ? document.branches.find((branch) => branch.id === source.branchId)
        : (populated.find((branch) => branch.role === 'ARTICLE') ?? populated[0]);
      if (!branch) throw new ContentReadError('BRANCH_UNAVAILABLE', source);
      const revision = source.revisionId
        ? this.repositories.videoDocuments.getRevision(branch.id, source.revisionId)
        : this.repositories.videoDocuments.getLatestRevision(branch.id);
      if (!revision)
        throw new ContentReadError(
          source.revisionId ? 'REVISION_UNAVAILABLE' : 'CURRENT_REVISION_UNAVAILABLE',
          { ...source, branchId: branch.id },
          branch.latestDraftRevisionId,
        );
      const content = revision.content;
      let markdown: string,
        bindings: { path: string; assetId: string }[] = [];
      let title = document.title;
      if (content.format === 'MARKDOWN') {
        markdown = content.markdown;
        bindings = content.mediaBindings;
      } else if (content.format === 'NOTE_COLLECTION') {
        const notes = source.noteId ? content.notes.filter((note) => note.id === source.noteId) : content.notes;
        if (!notes.length) throw new ContentReadError('NOTE_UNAVAILABLE', source, revision.id);
        markdown = notes
          .map(
            (note) =>
              `${!source.noteId && note.title ? `# ${note.title}\n\n` : ''}${replaceMarkdownMedia(note.markdown, new Map(note.mediaBindings.map((binding) => [binding.path, contentAssetPath(binding.assetId)])))}`,
          )
          .join('\n\n');
        bindings = notes.flatMap((note) =>
          note.mediaBindings.map((binding) => ({ ...binding, path: contentAssetPath(binding.assetId) })),
        );
        if (source.noteId) title = notes[0]!.title;
      } else if (content.format === 'TIMED_TRANSCRIPT')
        markdown = content.cues
          .map((cue) => `[${cue.startTimestampMs}–${cue.endTimestampMs}] ${plainTextMarkdown(cue.text)}`)
          .join('\n\n');
      else markdown = content.notes.map((note) => `[${note.timestampMs}] ${plainTextMarkdown(note.text)}`).join('\n\n');
      source = { ...source, branchId: branch.id };
      body = {
        title,
        revisionId: revision.id,
        markdown,
        media: bindings.flatMap((binding) => {
          const asset = revision.media.find((media) => media.assetId === binding.assetId);
          return asset
            ? [
                {
                  path: binding.path,
                  assetId: asset.assetId,
                  mediaUrl: asset.mediaUrl,
                  mimeType: asset.mimeType,
                  width: asset.width,
                  height: asset.height,
                  byteSize: asset.byteSize,
                },
              ]
            : [];
        }),
      };
    }
    return contentDocumentSchema.parse({
      ...body,
      source: { ...source, revisionId: body.revisionId },
      displayTitle: contentDisplayTitle(body.title, body.markdown),
      contentHash: hash(body.markdown),
      blocks: contentMarkdownBlocks(body.markdown),
    });
  }

  search(query: string, offset: number) {
    // Bound hydration to one page, including compressed article revisions. Search never loads the library at once.
    const rows = this.db
      .prepare(
        `SELECT * FROM (
      SELECT 'ARTICLE' kind, id, NULL branch_id, updated_at FROM articles WHERE deleted_at IS NULL AND status = 'ACTIVE'
      UNION ALL SELECT 'SOCIAL_POST', id, NULL, updated_at FROM social_post_drafts WHERE deleted_at IS NULL AND status = 'ACTIVE'
      UNION ALL SELECT 'INSPIRATION_STASH', id, NULL, updated_at FROM inspiration_stashes WHERE deleted_at IS NULL AND status = 'ACTIVE'
      UNION ALL SELECT 'VIDEO_DOCUMENT', d.id, b.id, d.updated_at FROM documents d JOIN document_branches b ON b.document_id = d.id WHERE d.deleted_at IS NULL AND d.status = 'ACTIVE' AND b.deleted_at IS NULL AND EXISTS(SELECT 1 FROM document_drafts draft JOIN document_draft_revisions r ON r.draft_id = draft.id WHERE draft.branch_id = b.id)
    ) ORDER BY updated_at DESC, kind, id, branch_id LIMIT 41 OFFSET ?`,
      )
      .all(offset) as { kind: ContentSource['kind']; id: string; branch_id: string | null }[];
    const needle = query.toLocaleLowerCase();
    const items = rows.slice(0, 40).flatMap((row) => {
      const source: ContentSource = {
        kind: row.kind,
        id: row.id,
        ...(row.branch_id ? { branchId: row.branch_id } : {}),
      };
      let document: ContentDocument;
      try {
        document = this.read(source);
      } catch {
        return [];
      }
      return !needle || `${document.title}\n${document.markdown}`.toLocaleLowerCase().includes(needle)
        ? [{ source: document.source, title: document.displayTitle, preview: document.blocks[0]?.preview ?? '' }]
        : [];
    });
    return { items, nextOffset: rows.length > 40 ? offset + 40 : null };
  }

  readableDocuments(source: ContentSource): { name: string; document: ContentDocument }[] {
    if (source.kind !== 'VIDEO_DOCUMENT')
      return [
        {
          name: { ARTICLE: '文章.md', SOCIAL_POST: '贴图.md', INSPIRATION_STASH: '便签.md' }[source.kind],
          document: this.read(source),
        },
      ];
    const video = this.repositories.videoDocuments.get(source.id);
    const labels: Record<string, string> = {
      ARTICLE: '文章',
      CLEAN_TRANSCRIPT: '转写',
      TRANSLATED_TRANSCRIPT: '译文',
      NOTES: '笔记',
    };
    const documents = video.branches
      .filter((branch) => branch.latestDraftRevisionId)
      .flatMap((branch) => {
        const revision = this.repositories.videoDocuments.getLatestRevision(branch.id);
        if (!revision)
          throw new ContentReadError(
            'CURRENT_REVISION_UNAVAILABLE',
            { ...source, branchId: branch.id },
            branch.latestDraftRevisionId,
          );
        const notes = revision?.content.format === 'NOTE_COLLECTION' ? revision.content.notes : [];
        if (revision && notes.length) {
          const assets = new Map(revision.media.map((media) => [media.assetId, media]));
          return notes.map((note, index) => ({
            name: `${labels[branch.role] ?? branch.role}-${index + 1}.md`,
            document: contentDocumentSchema.parse({
              source: { ...source, branchId: branch.id, noteId: note.id, revisionId: revision.id },
              title: note.title,
              displayTitle: contentDisplayTitle(note.title, note.markdown),
              revisionId: revision.id,
              contentHash: hash(note.markdown),
              markdown: note.markdown,
              media: note.mediaBindings.flatMap((binding) => {
                const asset = assets.get(binding.assetId);
                return asset
                  ? [
                      {
                        path: binding.path,
                        assetId: asset.assetId,
                        mediaUrl: asset.mediaUrl,
                        mimeType: asset.mimeType,
                        width: asset.width,
                        height: asset.height,
                        byteSize: asset.byteSize,
                      },
                    ]
                  : [];
              }),
              blocks: contentMarkdownBlocks(note.markdown),
            }),
          }));
        }
        return [
          { name: `${labels[branch.role] ?? branch.role}.md`, document: this.read({ ...source, branchId: branch.id }) },
        ];
      });
    if (!documents.length)
      documents.push({
        name: '文稿.md',
        document: contentDocumentSchema.parse({
          source,
          title: video.title,
          displayTitle: video.title || video.source.displayName,
          revisionId: video.updatedAt,
          contentHash: hash(''),
          markdown: '',
          media: [],
          blocks: [],
        }),
      });
    return documents;
  }

  capture(input: Extract<ContentLibraryCommand, { kind: 'capture' }>): ContentReference {
    return this.db.transaction(() => {
      const document = this.read({ ...input.source, revisionId: input.revisionId });
      if (
        document.contentHash !== input.contentHash ||
        input.end <= input.start ||
        input.end > document.markdown.length ||
        !(input.start === 0 || document.blocks.some((block) => block.start === input.start)) ||
        !(input.end === document.markdown.length || document.blocks.some((block) => block.end === input.end))
      )
        throw new Error('Content selection changed');
      const selected = contentMarkdownRange(document.markdown, input.start, input.end);
      const expanded = this.render(selected);
      const allMedia = [...document.media, ...expanded.media];
      const media = [...new Map(allMedia.map((asset) => [asset.assetId, asset])).values()];
      const markdown = replaceMarkdownMedia(
        expanded.markdown,
        new Map(allMedia.map((asset) => [asset.path, contentAssetPath(asset.assetId)])),
      );
      const paths = contentMarkdownMediaPaths(markdown);
      const referencedMedia = media.filter((asset) => paths.has(contentAssetPath(asset.assetId)));
      const reference = contentReferenceSchema.parse({
        id: ulid(),
        source: document.source,
        title: document.displayTitle,
        revisionId: document.revisionId,
        contentHash: hash(markdown),
        markdown,
        media: referencedMedia.map((asset) => ({ ...asset, path: contentAssetPath(asset.assetId) })),
        start: input.start,
        end: input.end,
        createdAt: now(),
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
      const insertAsset = this.db.prepare('INSERT INTO content_block_assets(reference_id, asset_id) VALUES (?, ?)');
      for (const asset of reference.media) insertAsset.run(reference.id, asset.assetId);
      return reference;
    })();
  }

  references(ids: string[]) {
    if (!ids.length) return [];
    const unique = [...new Set(ids)];
    const rows = this.db
      .prepare(`SELECT snapshot_json FROM content_block_references WHERE id IN (${unique.map(() => '?').join(',')})`)
      .all(...unique) as { snapshot_json: string }[];
    const byId = new Map(
      rows.map((row) => {
        const ref = contentReferenceSchema.parse(JSON.parse(row.snapshot_json));
        return [ref.id, ref] as const;
      }),
    );
    return unique.flatMap((id) => byId.get(id) ?? []);
  }

  render(markdown: string) {
    const matches = contentMarkdownReferences(markdown);
    if (matches.length > 100) throw new Error('Too many block references');
    const refs = new Map(this.references(matches.map((match) => match.id)).map((ref) => [ref.id, ref]));
    const media = new Map<string, ContentDocument['media'][number]>();
    let rendered = markdown;
    for (const match of [...matches].reverse()) {
      const ref = refs.get(match.id);
      if (!ref) throw new Error('Block reference unavailable');
      ref.media.forEach((asset) => media.set(asset.assetId, asset));
      const text = ref.markdown.replace(/\n/gu, '\n' + match.indent);
      if (rendered.length - (match.end - match.start) + text.length > 1_000_000)
        throw new Error('Expanded content is too large');
      rendered = rendered.slice(0, match.start) + text + rendered.slice(match.end);
    }
    if (rendered.length > 1_000_000) throw new Error('Expanded content is too large');
    return { markdown: rendered, media: [...media.values()] };
  }

  expandArticle<T extends ArticleContentInput>(content: T): T {
    const expanded = this.render(content.markdown);
    return {
      ...content,
      markdown: expanded.markdown,
      mediaBindings: [
        ...new Map(
          [
            ...content.mediaBindings,
            ...expanded.media.map((media) => ({ path: media.path, assetId: media.assetId })),
          ].map((binding) => [binding.path, binding]),
        ).values(),
      ],
    };
  }

  expandVideoRevision(revision: VideoDocumentRevisionDto): VideoDocumentRevisionDto {
    const additions = new Map<string, ContentDocument['media'][number]>();
    const expand = <T extends { markdown: string; mediaBindings: VideoDocumentMediaBinding[] }>(content: T): T => {
      const result = this.render(content.markdown);
      const bindings = result.media.map((media): VideoDocumentMediaBinding => {
        additions.set(media.assetId, media);
        return {
          path: media.path,
          assetId: media.assetId,
          kind: media.mimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE',
          timestampMs: null,
          endTimestampMs: null,
          posterAssetId: null,
        };
      });
      return {
        ...content,
        markdown: result.markdown,
        mediaBindings: [
          ...new Map([...content.mediaBindings, ...bindings].map((binding) => [binding.path, binding])).values(),
        ],
      };
    };
    const content =
      revision.content.format === 'MARKDOWN'
        ? expand(revision.content)
        : revision.content.format === 'NOTE_COLLECTION'
          ? { ...revision.content, notes: revision.content.notes.map(expand) }
          : revision.content;
    const media = [
      ...new Map(
        [
          ...revision.media,
          ...[...additions.values()].map(({ path: _path, ...asset }) =>
            videoDocumentRevisionMediaSchema.parse({
              ...asset,
              width: Math.max(1, asset.width),
              height: Math.max(1, asset.height),
              durationMs: null,
            }),
          ),
        ].map((asset) => [asset.assetId, asset]),
      ).values(),
    ];
    return { ...revision, content, media };
  }

  note(id: string) {
    const stash = this.repositories.inspirationStashes.get(id),
      content = stash.content;
    return desktopNoteSchema.parse({
      id,
      stashId: id,
      text: content.manualPrompt,
      document: content.document,
      title: content.title ?? '',
      displayTitle: stash.displayTitle,
      albumId: stash.albumId,
      format: content.format,
      contentHash: stash.contentHash,
      color: 'cream',
      icon: 'feather',
      editable: true,
      revisionId: null,
      references: content.referenceAssets.map((asset) => ({ assetId: asset.id, mediaUrl: asset.mediaUrl })),
      files: content.files,
    });
  }
  noteOpen(id: string) {
    const row = this.db
      .prepare('SELECT draft_json FROM content_editor_drafts WHERE source_id = ? ORDER BY updated_at DESC LIMIT 1')
      .get(id) as { draft_json: string } | undefined;
    const input = row ? desktopNoteDraftSchema.parse(JSON.parse(row.draft_json)) : null;
    const draft = input
      ? {
          text: input.text,
          document: input.document,
          title: input.title,
          format: input.format,
          referenceAssetIds: input.referenceAssetIds,
          expectedContentHash: input.expectedContentHash,
          editorId: input.editorId,
          sequence: input.sequence,
        }
      : null;
    return { note: this.note(id), draft };
  }
  noteCheckpoint(input: DesktopNoteDraft) {
    this.note(input.id);
    this.db
      .prepare(
        'INSERT INTO content_editor_drafts(source_id, editor_id, draft_json, sequence, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(source_id, editor_id) DO UPDATE SET draft_json = excluded.draft_json, sequence = excluded.sequence, updated_at = excluded.updated_at WHERE excluded.sequence > content_editor_drafts.sequence',
      )
      .run(input.id, input.editorId, JSON.stringify(input), input.sequence, now());
  }
  noteSave(input: DesktopNoteSave) {
    return this.db.transaction(() => {
      const { referenceAssets: _assets, ...content } = this.repositories.inspirationStashes.get(input.id).content;
      if (content.document && !input.document && input.text !== content.manualPrompt)
        throw new Error('BLOCK_DOCUMENT_REQUIRED');
      this.repositories.inspirationStashes.save({
        mode: 'UPDATE',
        id: input.id,
        expectedContentHash: input.expectedContentHash,
        consumeCreationDraftId: null,
        content: {
          ...content,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.format ? { format: input.format } : {}),
          ...(input.referenceAssetIds ? { referenceAssetIds: input.referenceAssetIds } : {}),
          ...(input.document ? { schemaVersion: 2, document: input.document } : {}),
          manualPrompt: input.text,
          promptNodes: replaceContentPromptText(content.promptNodes, input.text),
        },
      });
      const row = this.db
        .prepare('SELECT draft_json FROM content_editor_drafts WHERE source_id = ? AND editor_id = ?')
        .get(input.id, input.editorId) as { draft_json: string } | undefined;
      if (row) {
        const draft = desktopNoteDraftSchema.parse(JSON.parse(row.draft_json));
        if (
          draft.text === input.text &&
          draft.title === input.title &&
          draft.format === input.format &&
          JSON.stringify(draft.document) === JSON.stringify(input.document) &&
          JSON.stringify(draft.referenceAssetIds) === JSON.stringify(input.referenceAssetIds)
        )
          this.db
            .prepare('DELETE FROM content_editor_drafts WHERE source_id = ? AND editor_id = ?')
            .run(input.id, input.editorId);
      }
      return this.note(input.id);
    })();
  }
  private media(ids: readonly string[]): ContentDocument['media'] {
    if (!ids.length) return [];
    const rows = this.db
      .prepare(
        `SELECT id, mime_type, width, height, byte_size FROM image_assets WHERE id IN (${ids.map(() => '?').join(',')}) AND deleted_at IS NULL`,
      )
      .all(...ids) as { id: string; mime_type: string; width: number; height: number; byte_size: number }[];
    const byId = new Map(
      rows.map((row) => [
        row.id,
        {
          assetId: row.id,
          path: contentAssetPath(row.id),
          mediaUrl: mediaUrl(row.id),
          mimeType: row.mime_type,
          width: row.width,
          height: row.height,
          byteSize: row.byte_size,
        },
      ]),
    );
    return ids.flatMap((id) => byId.get(id) ?? []);
  }
}
