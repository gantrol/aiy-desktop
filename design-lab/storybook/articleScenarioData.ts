import type { ArticleDto, ArticleRevisionSaveInput, ArticleRevisionSaveResult } from '@/shared/contracts';
import { canonicalArticleContentJson } from '@/shared/contracts/article';
import { blockDocumentMarkdown } from '@/shared/block-document-codecs';
import type { enMessages } from '@/renderer/i18n/locales/en';
import { editorSampleDocument } from '../component-lab/editorSampleDocument';

export type ArticleScenario = 'existing' | 'blank' | 'saveFailure' | 'outline';
export type ArticleSampleCopy = { [Key in keyof typeof enMessages.designLab.storybook.sample]: string };

/** Public sample content. Each mount gets a new article and an in-memory save endpoint. */
export async function createArticleSample(copy: ArticleSampleCopy, scenario: ArticleScenario) {
  const document = editorSampleDocument(copy, scenario === 'blank');
  const content: ArticleDto['content'] = {
    schemaVersion: 2,
    document,
    title: scenario === 'blank' ? '' : copy.title,
    markdown: blockDocumentMarkdown(document),
    mediaBindings: [],
    mediaAssets: [],
    coverAssetId: null,
    ...(scenario === 'outline' ? { editorMode: 'OUTLINE' as const } : {}),
  };
  const { mediaAssets: _assets, ...input } = content;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalArticleContentJson(input)));
  const contentHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const initial: ArticleDto = {
    id: 'storybook-article',
    albumId: null,
    sourceInspirationStashId: null,
    authors: [],
    content,
    contentHash,
    revisionId: 'storybook-revision-1',
    revisionNo: 1,
    elements: [],
    comments: [],
    status: 'ACTIVE',
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
  };
  let article = initial;
  let rejectNextSave = scenario === 'saveFailure';
  const replies = new Map<string, ArticleRevisionSaveResult>();
  const save = async (request: ArticleRevisionSaveInput): Promise<ArticleRevisionSaveResult> => {
    if (request.articleId !== initial.id) throw new Error('STORY_ARTICLE_TARGET_MISMATCH');
    if (rejectNextSave) {
      rejectNextSave = false;
      throw new Error(copy.saveFailure);
    }
    const previous = replies.get(request.requestId);
    if (previous) return structuredClone(previous);
    if (request.expectedRevisionId !== article.revisionId)
      return {
        status: 'CONFLICT',
        requestId: request.requestId,
        sessionEpoch: request.sessionEpoch,
        draftSeq: request.draftSeq,
        expectedRevisionId: request.expectedRevisionId,
        reason: 'REVISION_CHANGED',
        currentArticle: structuredClone(article),
      };
    article = {
      ...article,
      content: { ...structuredClone(request.content), markdown: request.content.markdown ?? '', mediaAssets: [] },
      elements: structuredClone(request.elements ?? []),
      contentHash: request.contentHash,
      revisionNo: article.revisionNo + 1,
      revisionId: `storybook-revision-${article.revisionNo + 1}`,
    };
    const reply: ArticleRevisionSaveResult = {
      status: 'ACKNOWLEDGED',
      requestId: request.requestId,
      sessionEpoch: request.sessionEpoch,
      draftSeq: request.draftSeq,
      contentHash: request.contentHash,
      createdRevision: true,
      article: structuredClone(article),
    };
    replies.set(request.requestId, reply);
    return structuredClone(reply);
  };
  return { initial, save };
}
