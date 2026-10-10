import { useRef, useState } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ArticleCheckBlockInput, ArticleCheckInput, ArticleContentInput, Locale } from '@/shared/contracts';
import type { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';

function copiedBlocks(blocks: readonly ArticleCheckBlockInput[]) {
  return blocks.map((block) => ({ ...block }));
}

function checkIdentity(expectedRevisionId: string, content: ArticleContentInput) {
  return JSON.stringify({ expectedRevisionId, content });
}

function articleCheckProviderConfigurationRequired(reason: unknown) {
  if (!reason || typeof reason !== 'object') return false;
  return 'code' in reason && reason.code === 'ARTICLE_CHECK_PROVIDER_CONFIGURATION_REQUIRED';
}

export function useArticleCheck({
  locale,
  commentsBusy,
  session,
  notify,
  onConfigureProvider,
}: {
  locale: Locale;
  commentsBusy: boolean;
  session: ReturnType<typeof useArticleEditorSession>;
  notify(message: string): void;
  onConfigureProvider(): void;
}) {
  const [checking, setChecking] = useState(false);
  const labels = useI18n().messages.recipe.task;
  const operationRef = useRef(0);

  async function run() {
    if (checking || commentsBusy) return;
    const operation = operationRef.current + 1;
    operationRef.current = operation;
    setChecking(true);
    try {
      if (!(await session.flush('manual')) || operationRef.current !== operation) return;
      const persisted = session.capturePersistedArticle();
      const content = session.captureSnapshot();
      const blocks = copiedBlocks(session.getArticleCheckBlocksProjection());
      if (!blocks.length) {
        notify(labels.noBody);
        return;
      }
      const input: ArticleCheckInput = {
        articleId: persisted.id,
        expectedRevisionId: persisted.revisionId,
        locale,
        title: content.title,
        blocks,
      };
      const identity = checkIdentity(input.expectedRevisionId, content);
      const result = await window.desktopApi.articleCheck(input);
      if (operationRef.current !== operation) return;
      const currentArticle = session.capturePersistedArticle();
      const currentContent = session.captureSnapshot();
      if (checkIdentity(currentArticle.revisionId, currentContent) !== identity) {
        notify(labels.changed);
        return;
      }
      if (!result.findings.length) {
        notify(labels.noIssues);
        return;
      }
      if (!(await session.flush('manual')) || operationRef.current !== operation) return;
      const finalArticle = session.capturePersistedArticle();
      const finalContent = session.captureSnapshot();
      if (checkIdentity(finalArticle.revisionId, finalContent) !== identity) {
        notify(labels.changed);
        return;
      }
      const applied = await session.mutateComments(async (current) => {
        if (checkIdentity(current.revisionId, session.captureSnapshot()) !== identity) throw new Error(labels.changed);
        return window.desktopApi.articleCheckRunApply({ runId: result.run.id });
      });
      if (operationRef.current !== operation) return;
      if (!applied) return;
      notify(labels.added.replace('{count}', new Intl.NumberFormat(locale).format(applied.createdCommentIds.length)));
    } catch (reason) {
      if (operationRef.current === operation) {
        if (articleCheckProviderConfigurationRequired(reason)) {
          notify(labels.configure);
          onConfigureProvider();
        } else {
          const message = reason instanceof Error ? reason.message : String(reason);
          notify(message.includes('TASK_RECIPE_') ? labels.defaultUnavailable : message);
        }
      }
    } finally {
      if (operationRef.current === operation) setChecking(false);
    }
  }

  return { checking, run };
}
