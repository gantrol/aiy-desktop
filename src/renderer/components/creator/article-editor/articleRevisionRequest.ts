import type { ArticleContentInput, ArticleRevisionSaveInput } from '@/shared/contracts';
import { canonicalArticleContentJson } from '@/shared/contracts/article';
import { normalizeArticleContent } from '@/shared/article-revision';
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
  const content = normalizeArticleContent(input);
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
