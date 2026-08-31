import type { IpcRenderer } from 'electron';
import type { DesktopApi } from '@/shared/contracts';
import {
  articleCheckInvocationResultSchema,
  articleCheckInputSchema,
  articleCheckRunApplyInputSchema,
  articleCheckRunApplyResultSchema,
  articleCheckRunsListInputSchema,
  articleCheckRunsPageSchema,
  articleCopyForWechatInputSchema,
  articleCopyForWechatResultSchema,
  articleCommentMutationInputSchema,
  articleCommentMutationResultSchema,
  articleExportMarkdownInputSchema,
  articleExportMarkdownResultSchema,
  articleFormAddInputSchema,
  articleFormCreateInputSchema,
  articleMoveInputSchema,
  articleRenameInputSchema,
  articleRevisionGetInputSchema,
  articleRevisionHistoryInputSchema,
  articleRevisionHistoryResultSchema,
  articleRevisionSchema,
  articleRevisionSaveInputSchema,
  articleRevisionSaveResultSchema,
  articleSaveInputSchema,
  articleSetArchivedInputSchema,
} from '@/shared/contracts/article';

type ArticlePreloadApi = Pick<
  DesktopApi,
  | 'articleSave'
  | 'articleRevisionHistory'
  | 'articleRevisionGet'
  | 'articleRevisionSave'
  | 'articleCommentMutate'
  | 'articleCheck'
  | 'articleCheckRunsList'
  | 'articleCheckRunApply'
  | 'articleFormAdd'
  | 'articleFormCreate'
  | 'articleRename'
  | 'articleMove'
  | 'articleSetArchived'
  | 'articleCopyForWechat'
  | 'articleExportMarkdown'
>;

export function createArticlePreloadApi(ipcRenderer: IpcRenderer): ArticlePreloadApi {
  return {
    articleSave: (input) => ipcRenderer.invoke('article:save', articleSaveInputSchema.parse(input)),
    articleRevisionHistory: async (input) =>
      articleRevisionHistoryResultSchema.parse(
        await ipcRenderer.invoke('article:revision-history', articleRevisionHistoryInputSchema.parse(input)),
      ),
    articleRevisionGet: async (input) =>
      articleRevisionSchema.parse(
        await ipcRenderer.invoke('article:revision-get', articleRevisionGetInputSchema.parse(input)),
      ),
    articleRevisionSave: async (input) =>
      articleRevisionSaveResultSchema.parse(
        await ipcRenderer.invoke('article:revision-save', articleRevisionSaveInputSchema.parse(input)),
      ),
    articleCommentMutate: async (input) =>
      articleCommentMutationResultSchema.parse(
        await ipcRenderer.invoke('article:comment-mutate', articleCommentMutationInputSchema.parse(input)),
      ),
    articleCheck: async (input) => {
      const invocation = articleCheckInvocationResultSchema.parse(
        await ipcRenderer.invoke('article:check', articleCheckInputSchema.parse(input)),
      );
      if (invocation.status === 'error') {
        throw Object.assign(new Error(invocation.error.message), { code: invocation.error.code });
      }
      return invocation.result;
    },
    articleCheckRunsList: async (input) =>
      articleCheckRunsPageSchema.parse(
        await ipcRenderer.invoke('article:check-runs-list', articleCheckRunsListInputSchema.parse(input)),
      ),
    articleCheckRunApply: async (input) =>
      articleCheckRunApplyResultSchema.parse(
        await ipcRenderer.invoke('article:check-run-apply', articleCheckRunApplyInputSchema.parse(input)),
      ),
    articleFormAdd: (input) => ipcRenderer.invoke('article:form-add', articleFormAddInputSchema.parse(input)),
    articleFormCreate: (input) => ipcRenderer.invoke('article:form-create', articleFormCreateInputSchema.parse(input)),
    articleRename: (input) => ipcRenderer.invoke('article:rename', articleRenameInputSchema.parse(input)),
    articleMove: (input) => ipcRenderer.invoke('article:move', articleMoveInputSchema.parse(input)),
    articleSetArchived: (input) =>
      ipcRenderer.invoke('article:set-archived', articleSetArchivedInputSchema.parse(input)),
    articleCopyForWechat: async (input) =>
      articleCopyForWechatResultSchema.parse(
        await ipcRenderer.invoke('article:copy-for-wechat', articleCopyForWechatInputSchema.parse(input)),
      ),
    articleExportMarkdown: async (input) =>
      articleExportMarkdownResultSchema.parse(
        await ipcRenderer.invoke('article:export-markdown', articleExportMarkdownInputSchema.parse(input)),
      ),
  };
}
