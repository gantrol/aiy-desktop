import type {
  ArticleCheckResult,
  ArticleCheckApplyInput,
  ArticleMoveInput,
  ArticleRenameInput,
  ArticleSaveInput,
  ArticleSetArchivedInput,
} from '@/shared/contracts';
import type {
  ArticleCheckRunApplyInput,
  ArticleCheckRunsListInput,
  ArticleCommentMutationInput,
  ArticleFormAddInput,
  ArticleFormCreateInput,
  ArticleRevisionGetInput,
  ArticleRevisionHistoryInput,
  ArticleRevisionSaveInput,
} from '@/shared/contracts/article';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import { localArticleWriteContext, type ArticleWriteContext } from '@/main/database/creations/article-write-context';
import type {
  ArticleInputHistoryQuery,
  ArticleInputRecordQuery,
  ArticleInputContinueQuery,
} from '@/shared/contracts/article-input-history';

export function createArticleApi(
  repositories: Pick<LibraryDatabaseRepositories, 'articleChecks' | 'articles' | 'articleInputs' | 'storage'>,
) {
  return {
    getArticleInputHistory(input: ArticleInputHistoryQuery) {
      return repositories.articleInputs.list(input);
    },

    getArticleInputRecord(input: ArticleInputRecordQuery) {
      return repositories.articleInputs.get(input);
    },

    continueArticleInput(input: ArticleInputContinueQuery) {
      return repositories.articleInputs.continue(input);
    },

    listArticles() {
      return repositories.articles.list();
    },

    listArticleSummaries() {
      return repositories.articles.listSummaries();
    },

    getArticle(id: string) {
      return repositories.articles.get(id);
    },

    getArticleRevision(input: ArticleRevisionGetInput) {
      return repositories.articles.getRevision(input);
    },

    getArticleRevisionHistory(input: ArticleRevisionHistoryInput) {
      return repositories.articles.revisionHistory(input);
    },

    saveArticle(input: ArticleSaveInput, context?: ArticleWriteContext) {
      return repositories.articles.save(input, undefined, context ?? localArticleWriteContext(repositories.storage.db));
    },

    saveArticleRevision(input: ArticleRevisionSaveInput, context?: ArticleWriteContext) {
      return repositories.articles.saveRevision(
        input,
        context ?? localArticleWriteContext(repositories.storage.db, input.requestId),
      );
    },

    mutateArticleComment(input: ArticleCommentMutationInput) {
      return repositories.articles.mutateComment(input);
    },

    applyArticleCheck(input: ArticleCheckApplyInput) {
      return repositories.articles.applyCheck(input);
    },

    listArticleCheckRuns(input: ArticleCheckRunsListInput) {
      return repositories.articleChecks.list(input);
    },

    startArticleCheck(input: Parameters<LibraryDatabaseRepositories['articleChecks']['start']>[0]) {
      return repositories.articleChecks.start(input);
    },

    completeArticleCheck(runId: string, result: ArticleCheckResult) {
      return repositories.articleChecks.complete(runId, result);
    },

    failArticleCheck(runId: string, reason: unknown) {
      return repositories.articleChecks.fail(runId, reason);
    },

    applyArticleCheckRun(input: ArticleCheckRunApplyInput) {
      return repositories.articleChecks.apply(input.runId);
    },

    addArticleForm(input: ArticleFormAddInput) {
      return repositories.articles.addForm(input, localArticleWriteContext(repositories.storage.db));
    },

    createArticleForm(input: ArticleFormCreateInput) {
      return repositories.articles.createForm(input, localArticleWriteContext(repositories.storage.db));
    },

    renameArticle(input: ArticleRenameInput) {
      return repositories.articles.rename(input);
    },

    moveArticle(input: ArticleMoveInput) {
      return repositories.articles.move(input);
    },

    setArticleArchived(input: ArticleSetArchivedInput) {
      return repositories.articles.setArchived(input);
    },
  };
}
