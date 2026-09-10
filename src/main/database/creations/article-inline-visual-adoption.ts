import { articleIllustrationInsertionOffset } from '@/shared/article-wechat-renderer';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import type {
  ArticleContentInput,
  ArticleDto,
  ArticleMediaBindingInput,
  DerivedVisualAdoptInput,
  DerivedVisualDto,
} from '@/shared/contracts';
import { captureBlockDocument, type BlockNode } from '@/shared/contracts/block-document';
import {
  articleVisualPositionState,
  derivedVisualImageExtension,
  isArticleVisualPositionPath,
  type ArticleVisualPositionState,
} from '@/shared/derived-visual-media';

export class ArticleVisualPositionError extends Error {}

function assertPositionCanBeAdopted(position: ArticleVisualPositionState, relocateAfterText: string | undefined) {
  if (position.status === 'AMBIGUOUS') throw new ArticleVisualPositionError('ARTICLE_VISUAL_POSITION_AMBIGUOUS');
  if (position.status === 'PLACED' && relocateAfterText !== undefined)
    throw new ArticleVisualPositionError('ARTICLE_VISUAL_POSITION_CHANGED');
  if (position.status === 'MISSING' && relocateAfterText === undefined)
    throw new ArticleVisualPositionError('ARTICLE_VISUAL_POSITION_MISSING');
}

function insertIllustrationAfterPassage(markdown: string, passage: string, path: string, imageAlt: string): string {
  const insertionAt = articleIllustrationInsertionOffset(markdown, passage);
  if (insertionAt === null) throw new ArticleVisualPositionError('ARTICLE_VISUAL_ANCHOR_UNAVAILABLE');
  const escapedAlt = imageAlt.replace(/[\\[\]]/gu, '\\$&');
  return [
    markdown.slice(0, insertionAt).trimEnd(),
    `![${escapedAlt}](${path})`,
    markdown.slice(insertionAt).trimStart(),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function independentCoverBinding(
  content: ArticleDto['content'],
  mediaBindings: readonly ArticleMediaBindingInput[],
): ArticleMediaBindingInput | null {
  const coverAssetId = content.coverAssetId;
  if (!coverAssetId || mediaBindings.some((binding) => binding.assetId === coverAssetId)) return null;
  const cover = content.mediaAssets.find((asset) => asset.id === coverAssetId);
  const extension = derivedVisualImageExtension(cover?.mimeType ?? '');
  let path = `assets/cover-${coverAssetId}.${extension}`;
  for (let suffix = 1; mediaBindings.some((binding) => binding.path === path); suffix += 1)
    path = `assets/cover-${coverAssetId}-${suffix}.${extension}`;
  return { path, assetId: coverAssetId };
}

/** The position owns the binding path; changing its candidate never changes another binding for the same asset. */
export function adoptArticleInlineVisual(
  visual: DerivedVisualDto,
  article: ArticleDto,
  input: DerivedVisualAdoptInput,
  extension: string,
): ArticleContentInput {
  const positionId = visual.positionId;
  if (!positionId) throw new ArticleVisualPositionError('ARTICLE_VISUAL_POSITION_UNAVAILABLE');
  const position = articleVisualPositionState(visual, article);
  assertPositionCanBeAdopted(position, input.relocateAfterText);
  const { mediaAssets: _mediaAssets, ...content } = article.content;
  // Reuse the placed path even when the candidate format changes; MIME comes from the bound asset.
  const placementPath = position.binding?.path ?? `assets/position-${positionId}-${input.imageAssetId}.${extension}`;
  const markdown =
    position.status === 'PLACED'
      ? content.markdown
      : insertIllustrationAfterPassage(
          content.markdown,
          input.relocateAfterText ?? visual.anchor?.selectedText ?? '',
          placementPath,
          input.imageAlt ?? '',
        );
  // Retire unused bindings for this position while preserving the cover and other uses of the same asset.
  const mediaBindings = content.mediaBindings.filter(
    (binding) =>
      binding.path !== placementPath &&
      (!isArticleVisualPositionPath(binding.path, positionId) ||
        content.coverAssetId === binding.assetId ||
        markdown.includes(binding.path)),
  );
  mediaBindings.push({ path: placementPath, assetId: input.imageAssetId });
  // A cover that shared the replaced binding needs its own binding to keep the original image.
  const coverBinding = independentCoverBinding(article.content, mediaBindings);
  if (coverBinding) mediaBindings.push(coverBinding);
  if (content.document) {
    let root = content.document.root;
    if (position.status === 'PLACED') {
      let matched = 0;
      const replace = (node: BlockNode): BlockNode => {
        if (node.type === 'image' && node.attrs?.mediaPath === placementPath) {
          matched++;
          return {
            ...node,
            attrs: {
              ...node.attrs,
              assetId: input.imageAssetId,
              mediaPath: placementPath,
              ...(input.imageAlt !== undefined ? { alt: input.imageAlt } : {}),
            },
          };
        }
        return { ...node, ...(node.content ? { content: node.content.map(replace) } : {}) };
      };
      root = replace(root);
      if (matched !== 1) throw new ArticleVisualPositionError('ARTICLE_VISUAL_POSITION_AMBIGUOUS');
    } else {
      const offset = articleIllustrationInsertionOffset(
        content.markdown,
        input.relocateAfterText ?? visual.anchor?.selectedText ?? '',
      );
      if (offset === null) throw new ArticleVisualPositionError('ARTICLE_VISUAL_ANCHOR_UNAVAILABLE');
      const children = [...(root.content ?? [])];
      let after = children.length;
      for (let count = 1; count <= children.length; count++) {
        const prefix = blockDocumentMarkdown(
          { ...content.document, root: { ...root, content: children.slice(0, count) } },
          content.mediaBindings,
        );
        if (prefix.trimEnd().length >= offset) {
          after = count;
          break;
        }
      }
      children.splice(after, 0, {
        type: 'image',
        attrs: { assetId: input.imageAssetId, mediaPath: placementPath, alt: input.imageAlt ?? '' },
      });
      root = { ...root, content: children };
    }
    const document = captureBlockDocument(root);
    return { ...content, document, markdown: blockDocumentMarkdown(document, mediaBindings), mediaBindings };
  }
  return { ...content, markdown, mediaBindings };
}
