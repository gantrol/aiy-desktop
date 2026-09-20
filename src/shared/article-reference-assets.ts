import type { ArticleContentInput } from '@/shared/contracts';
import { articleWechatImageReferences, normalizeArticleWechatMediaPath } from '@/shared/article-wechat-renderer';
import { blockDocumentAssetIds } from '@/shared/contracts/block-document';
import { articleCoverAssetIds } from '@/shared/article-covers';

/** Current source images, in cover/document order; unused editor bindings are not references. */
export function articleReferenceAssetIds(content: ArticleContentInput): string[] {
  const bindings = new Map(
    content.mediaBindings.map((binding) => [normalizeArticleWechatMediaPath(binding.path), binding.assetId]),
  );
  const references = articleWechatImageReferences(content.markdown);
  return [
    ...new Set([
      ...articleCoverAssetIds(content),
      ...(content.document ? blockDocumentAssetIds(content.document) : []),
      ...[...references.localImagePaths, ...references.remoteImageUrls].flatMap((path) => {
        const id = bindings.get(normalizeArticleWechatMediaPath(path));
        return id ? [id] : [];
      }),
    ]),
  ];
}
