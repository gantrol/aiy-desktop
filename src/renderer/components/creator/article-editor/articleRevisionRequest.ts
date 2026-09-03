import type { ArticleContentInput, ArticleRevisionSaveInput } from '@/shared/contracts';
import { articleContentSchema, canonicalArticleContentJson } from '@/shared/contracts/article';
import { removeUnboundArticleMarkdownImages } from '@/shared/article-wechat-renderer';
import { sha256Hex } from '@/renderer/lib/sha256Hex';

interface ArticleRevisionRequestIdentity {
  articleId: string;
  cause: ArticleRevisionSaveInput['cause'];
  expectedRevisionId: string;
  requestId?: string;
  sessionEpoch: string;
  draftSeq: number;
}

export async function createArticleRevisionSaveRequest(
  input: ArticleContentInput,
  identity: ArticleRevisionRequestIdentity,
): Promise<ArticleRevisionSaveInput> {
  const markdown = removeUnboundArticleMarkdownImages(
    input.markdown,
    input.mediaBindings.map((binding) => binding.path),
  );
  const content = articleContentSchema.parse({
    ...input,
    markdown,
    mediaBindings: input.mediaBindings.map((binding) => ({ ...binding })),
  });
  const contentHash = await sha256Hex(canonicalArticleContentJson(content));
  return {
    requestId: identity.requestId ?? globalThis.crypto.randomUUID(),
    articleId: identity.articleId,
    sessionEpoch: identity.sessionEpoch,
    draftSeq: identity.draftSeq,
    cause: identity.cause,
    expectedRevisionId: identity.expectedRevisionId,
    contentHash,
    content,
  };
}
