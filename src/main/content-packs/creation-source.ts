import { createHash } from 'node:crypto';
import { importMarkdownContent } from '@/main/creations/import-markdown';
import type { ContentPackCreations } from '@/shared/contracts/content-pack-creations';
import { articleContentSchema } from '@/shared/contracts/article';
import type { BlockNode } from '@/shared/contracts/block-document';
import { parseAiyDeepLink } from '@/shared/contracts/app-deep-link';
import type { FixturePackSupplementalItem } from '@/main/database/packs/fixture-pack-source';

export function creationPackHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function creationPackId(packId: string, kind: string, key: string) {
  return `pack-${kind}_${creationPackHash([packId, key]).slice(0, 40)}`;
}

/** Pure preparation: the same source yields the same release, independent of the destination library. */
export function prepareContentPackCreations(packId: string, source: ContentPackCreations, spaceId: string) {
  const albumId = creationPackId(packId, 'album', 'creations');
  const workIds = new Map(source.works.map((work) => [work.key, creationPackId(packId, 'work', work.key)]));
  const links = new Map(
    source.works.map((work) => [work.file, `aiy://open/space/${spaceId}/article/${workIds.get(work.key)!}`]),
  );
  const rewriteHref = (href: string) => {
    const target = links.get(href.replace(/^\.\//u, ''));
    if (target) return target;
    if (/^(https?:\/\/|mailto:|tel:)/iu.test(href) || parseAiyDeepLink(href)) return href;
    throw new Error(`CONTENT_PACK_CREATION_LINK_INVALID: ${href}`);
  };
  const works = source.works.map((work) => {
    const sourceHash = creationPackHash(work);
    const content = importMarkdownContent(work.title, work.markdown, work.kind);
    // Markdown carries no block identities. Republishing changed Markdown must not
    // misidentify a new block as an old referenced block at the same position.
    const rewrite = (node: BlockNode, position: string): BlockNode => ({
      ...node,
      ...(node.attrs
        ? {
            attrs: {
              ...node.attrs,
              ...(node.attrs.blockId
                ? { blockId: creationPackId(packId, 'block', `${work.key}:${sourceHash}:${position}`) }
                : {}),
            },
          }
        : {}),
      ...(node.marks
        ? {
            marks: node.marks.map((mark) =>
              mark.type === 'link' && typeof mark.attrs?.href === 'string'
                ? { ...mark, attrs: { ...mark.attrs, href: rewriteHref(mark.attrs.href) } }
                : mark,
            ),
          }
        : {}),
      ...(node.content ? { content: node.content.map((child, index) => rewrite(child, `${position}.${index}`)) } : {}),
    });
    return {
      ...work,
      id: workIds.get(work.key)!,
      sourceHash,
      content: articleContentSchema.parse({
        ...content,
        document: { ...content.document!, root: rewrite(content.document!.root, '0') },
      }),
    };
  });
  const layout = {
    contract: 'CONTENT_PACK_CREATIONS_V1' as const,
    albumId,
    title: source.title,
    titleLocale: source.titleLocale,
    description: source.description,
    groups: source.creationItems.map((item) => ({
      id: creationPackId(packId, 'item', item.key),
      primaryWorkId: workIds.get(item.primaryWorkKey)!,
      workIds: item.workKeys.map((key) => workIds.get(key)!),
    })),
  };
  const layoutHash = creationPackHash(layout);
  const base = {
    inclusionKind: 'CORE' as const,
    visibility: 'VISIBLE' as const,
    rightsStatus: 'UNSPECIFIED',
    provenance: { source: 'CONTENT_PACKAGE', packId },
  };
  const items: FixturePackSupplementalItem[] = [
    {
      ...base,
      itemKey: 'creations:layout',
      objectType: 'CREATION_COLLECTION',
      objectRevisionId: `content-creations:${layoutHash}`,
      contentHash: `sha256:${layoutHash}`,
      metadata: layout,
      localObjectType: 'ALBUM',
      localObjectId: albumId,
      localRevisionId: layoutHash,
    },
    ...works.map((work) => ({
      ...base,
      itemKey: `work:${work.key}`,
      objectType: 'ARTICLE_REVISION',
      objectRevisionId: `content-work:${work.sourceHash}`,
      contentHash: `sha256:${work.sourceHash}`,
      metadata: {
        contract: 'CONTENT_PACK_WORK_V1',
        workKey: work.key,
        workId: work.id,
        kind: work.kind,
        file: work.file,
        sourceHash: work.sourceHash,
      },
      localObjectType: 'ARTICLE',
      localObjectId: work.id,
      localRevisionId: '',
    })),
  ];
  return { layout, works, items };
}

export type PreparedContentPackCreations = ReturnType<typeof prepareContentPackCreations>;
