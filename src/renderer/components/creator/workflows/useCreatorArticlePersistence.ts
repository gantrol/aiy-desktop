import type { ArticleRevisionSaveInput, ArticleRevisionSaveResult } from '@/shared/contracts';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

function assertAcknowledgesRequest(input: ArticleRevisionSaveInput, result: ArticleRevisionSaveResult) {
  if (
    result.requestId !== input.requestId ||
    result.sessionEpoch !== input.sessionEpoch ||
    result.draftSeq !== input.draftSeq
  ) {
    throw new Error('Article save acknowledgement identity does not match the request');
  }
  if (result.status === 'ACKNOWLEDGED' && result.contentHash !== input.contentHash) {
    throw new Error('Article save acknowledgement content does not match the request');
  }
  if (result.status === 'CONFLICT' && result.expectedRevisionId !== input.expectedRevisionId) {
    throw new Error('Article conflict acknowledgement does not match the expected revision');
  }
}

export function useCreatorArticlePersistence() {
  const saveArticleRevision = useStableCallback(
    async (input: ArticleRevisionSaveInput): Promise<ArticleRevisionSaveResult> => {
      const result = await window.desktopApi.articleRevisionSave(input);
      assertAcknowledgesRequest(input, result);
      return result;
    },
  );

  return { saveArticleRevision };
}
