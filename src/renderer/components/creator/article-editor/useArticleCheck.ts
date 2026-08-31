import { useRef, useState } from 'react';
import type {
  ArticleCheckBlockInput,
  ArticleCheckInput,
  ArticleCheckApplyResult,
  ArticleContentInput,
  Locale,
} from '@/shared/contracts';
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
  onApplied,
}: {
  locale: Locale;
  commentsBusy: boolean;
  session: ReturnType<typeof useArticleEditorSession>;
  notify(message: string): void;
  onConfigureProvider(): void;
  onApplied(result: ArticleCheckApplyResult): void;
}) {
  const [checking, setChecking] = useState(false);
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
        notify(locale === 'zh' ? '没有可检查的正文' : 'There is no article body to check');
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
        notify(
          locale === 'zh'
            ? '文章已变化，检查结果已保留在 AI 中心'
            : 'The article changed; the check result is available in AI Center',
        );
        return;
      }
      if (!result.findings.length) {
        notify(locale === 'zh' ? '未发现明确问题' : 'No clear issues found');
        return;
      }
      if (!(await session.flush('manual')) || operationRef.current !== operation) return;
      const finalArticle = session.capturePersistedArticle();
      const finalContent = session.captureSnapshot();
      if (checkIdentity(finalArticle.revisionId, finalContent) !== identity) {
        notify(
          locale === 'zh'
            ? '文章已变化，检查结果已保留在 AI 中心'
            : 'The article changed; the check result is available in AI Center',
        );
        return;
      }
      const applied = await window.desktopApi.articleCheckRunApply({ runId: result.run.id });
      if (operationRef.current !== operation) return;
      onApplied(applied);
      notify(
        locale === 'zh'
          ? `${applied.createdCommentIds.length} 条检查意见已加入评论`
          : `${applied.createdCommentIds.length} check findings added as comments`,
      );
    } catch (reason) {
      if (operationRef.current === operation) {
        if (articleCheckProviderConfigurationRequired(reason)) {
          notify(locale === 'zh' ? '请先配置并授权 Codex Agent' : 'Configure and authorize Codex Agent first');
          onConfigureProvider();
        } else {
          notify(reason instanceof Error ? reason.message : String(reason));
        }
      }
    } finally {
      if (operationRef.current === operation) setChecking(false);
    }
  }

  return { checking, run };
}
