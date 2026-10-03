import {
  REFERENCE_NAVIGATION_EVENT,
  type ReferenceNavigationRequest,
} from '@/renderer/features/content-editor/contentReferenceNavigation';
import type { CommentCompilationResult } from '@/shared/contracts/comment-compilation-result';

export async function openCompiledArticle(
  result: CommentCompilationResult,
  context: {
    sourceTabId: string;
    originArticleId: string;
    isCurrent(): boolean;
    flush(): Promise<boolean>;
  },
) {
  if (!(await context.flush())) throw new Error('REFERENCE_SAVE_FAILED');
  if (!context.isCurrent()) return;
  await new Promise<void>((resolve, reject) => {
    const request: ReferenceNavigationRequest = {
      target: { source: { kind: 'ARTICLE', id: result.article.id } },
      sourceTabId: context.sourceTabId,
      originArticleId: context.originArticleId,
      placement: 'beside',
      isCurrent: context.isCurrent,
      accept: (operation) => {
        void operation.then(resolve, reject);
      },
    };
    const handled = !window.dispatchEvent(
      new CustomEvent(REFERENCE_NAVIGATION_EVENT, { detail: request, cancelable: true }),
    );
    if (!handled) reject(new Error('REFERENCE_NAVIGATION_UNSUPPORTED'));
  });
}
