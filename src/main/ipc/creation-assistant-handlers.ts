import { shell, type OpenDialogOptions, type OpenDialogReturnValue } from 'electron';
import { z } from 'zod';
import type { CodexService } from '@/main/assistant/codex-service';
import type { ArticleCheckInput } from '@/shared/contracts';
import type { ArticleCheckExecutionResult } from '@/shared/contracts/article';
import { CreatorImageStagingService } from '@/main/creations/creator-image-staging';
import type { ArticleExportService } from '@/main/creations/article-export-service';
import type { ArticleWechatCopyService } from '@/main/creations/article-wechat-copy-service';
import type { LibraryDatabase } from '@/main/database';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import {
  inspirationStashMoveInputSchema,
  inspirationStashSaveInputSchema,
  inspirationStashSetArchivedInputSchema,
} from '@/shared/contracts/inspiration-stash';
import {
  socialPostFormAddInputSchema,
  socialPostFormCreateInputSchema,
  socialPostMoveInputSchema,
  socialPostSaveInputSchema,
  socialPostSetArchivedInputSchema,
} from '@/shared/contracts/social-post';
import {
  articleCheckInvocationResultSchema,
  articleCheckInputSchema,
  articleCheckRunApplyInputSchema,
  articleCheckRunApplyResultSchema,
  articleCheckRunsListInputSchema,
  articleCheckRunsPageSchema,
  articleFormAddInputSchema,
  articleFormCreateInputSchema,
  articleCopyForWechatInputSchema,
  articleCommentMutationInputSchema,
  articleExportMarkdownInputSchema,
  articleMoveInputSchema,
  articleRenameInputSchema,
  articleRevisionGetInputSchema,
  articleRevisionHistoryInputSchema,
  articleRevisionSaveInputSchema,
  articleSaveInputSchema,
  articleSetArchivedInputSchema,
} from '@/shared/contracts/article';
import {
  derivedVisualAdoptInputSchema,
  derivedVisualWorkspaceOpenInputSchema,
} from '@/shared/contracts/derived-visual';
import { codexThreadHref, codexThreadIdSchema } from '@/shared/contracts/codex-thread';
import {
  promptSeriesCoverSetInputSchema,
  promptSeriesOutputRemoveInputSchema,
} from '@/shared/contracts/creation-output-presentation';
import {
  assistantProposalAdoptionSchema,
  creationDraftCommitSchema,
  creationDraftLoadSchema,
  creationDraftSaveSchema,
  creationDraftStartSchema,
  creationAlbumRenameSchema,
  creationInputStashCreateSchema,
  creatorAgentAssistSchema,
  creatorAgentChatSchema,
  creatorAgentHistorySchema,
  creatorAgentScopeSchema,
  deleteSeriesSchema,
  id,
  materialCollectionCreateFromSourceSchema,
  materialDestinationsAddSchema,
  renameSeriesSchema,
  titleSchema,
} from '@/main/ipc/schemas';

interface CreationAssistantIpcOptions {
  ipcMain: IpcHandlerRegistrar;
  database: LibraryDatabase;
  codex: CodexService;
  chooseFile: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
  runAssistantRequest: (request: z.infer<typeof creatorAgentAssistSchema>) => unknown;
  runTitleRequest: (request: z.infer<typeof titleSchema>) => unknown;
  runArticleCheckRequest: (request: ArticleCheckInput) => Promise<ArticleCheckExecutionResult>;
  articleExports: ArticleExportService;
  articleWechatCopy: ArticleWechatCopyService;
}

function articleCheckInvocationFailure(reason: unknown) {
  const source = reason && typeof reason === 'object' ? reason : null;
  const rawCode = source && 'code' in source && typeof source.code === 'string' ? source.code : 'ARTICLE_CHECK_FAILED';
  const code = rawCode.trim().slice(0, 100) || 'ARTICLE_CHECK_FAILED';
  const rawMessage = reason instanceof Error ? reason.message : String(reason);
  const message = rawMessage.trim().slice(0, 2_000) || 'Article check failed';
  return { code, message };
}

export function registerCreationAssistantIpc({
  ipcMain,
  database,
  codex,
  chooseFile,
  runAssistantRequest,
  runTitleRequest,
  runArticleCheckRequest,
  articleExports,
  articleWechatCopy,
}: CreationAssistantIpcOptions) {
  const referenceStages = new CreatorImageStagingService(() => database);
  ipcMain.handle('creation-draft:start', (_event, raw) =>
    database.startCreationDraft(creationDraftStartSchema.parse(raw)),
  );
  ipcMain.handle('creation-draft:load', (_event, raw) =>
    database.loadCreationDraft(creationDraftLoadSchema.parse(raw)),
  );
  ipcMain.handle('creation-draft:save', (_event, raw) =>
    database.saveCreationDraft(creationDraftSaveSchema.parse(raw)),
  );
  ipcMain.handle('creation-draft:commit', (_event, raw) =>
    database.commitCreationDraft(creationDraftCommitSchema.parse(raw)),
  );
  ipcMain.handle('derived-visual:workspace-open', (_event, raw) =>
    database.openDerivedVisualWorkspace(derivedVisualWorkspaceOpenInputSchema.parse(raw)),
  );
  ipcMain.handle('derived-visual:adopt', (_event, raw) =>
    database.adoptDerivedVisual(derivedVisualAdoptInputSchema.parse(raw)),
  );
  ipcMain.handle('creation-input-stashes:list', (_event, raw) =>
    database.listCreationInputStashes(creatorAgentScopeSchema.parse(raw)),
  );
  ipcMain.handle('creation-input-stash:create', (_event, raw) =>
    database.createCreationInputStash(creationInputStashCreateSchema.parse(raw)),
  );
  ipcMain.handle('inspiration-stash:save', (_event, raw) =>
    database.saveInspirationStash(inspirationStashSaveInputSchema.parse(raw)),
  );
  ipcMain.handle('inspiration-stash:move', (_event, raw) =>
    database.moveInspirationStash(inspirationStashMoveInputSchema.parse(raw)),
  );
  ipcMain.handle('inspiration-stash:set-archived', (_event, raw) =>
    database.setInspirationStashArchived(inspirationStashSetArchivedInputSchema.parse(raw)),
  );
  ipcMain.handle('social-post:save', (_event, raw) => database.saveSocialPost(socialPostSaveInputSchema.parse(raw)));
  ipcMain.handle('social-post:form-add', (_event, raw) =>
    database.addSocialPostForm(socialPostFormAddInputSchema.parse(raw)),
  );
  ipcMain.handle('social-post:form-create', (_event, raw) =>
    database.createSocialPostForm(socialPostFormCreateInputSchema.parse(raw)),
  );
  ipcMain.handle('social-post:move', (_event, raw) => database.moveSocialPost(socialPostMoveInputSchema.parse(raw)));
  ipcMain.handle('social-post:set-archived', (_event, raw) =>
    database.setSocialPostArchived(socialPostSetArchivedInputSchema.parse(raw)),
  );
  ipcMain.handle('article:save', (_event, raw) => database.saveArticle(articleSaveInputSchema.parse(raw)));
  ipcMain.handle('article:revision-history', (_event, raw) =>
    database.getArticleRevisionHistory(articleRevisionHistoryInputSchema.parse(raw)),
  );
  ipcMain.handle('article:revision-get', (_event, raw) =>
    database.getArticleRevision(articleRevisionGetInputSchema.parse(raw)),
  );
  ipcMain.handle('article:revision-save', (_event, raw) =>
    database.saveArticleRevision(articleRevisionSaveInputSchema.parse(raw)),
  );
  ipcMain.handle('article:comment-mutate', (_event, raw) =>
    database.mutateArticleComment(articleCommentMutationInputSchema.parse(raw)),
  );
  ipcMain.handle('article:check', async (_event, raw) => {
    try {
      return articleCheckInvocationResultSchema.parse({
        status: 'success',
        result: await runArticleCheckRequest(articleCheckInputSchema.parse(raw)),
      });
    } catch (reason) {
      return articleCheckInvocationResultSchema.parse({
        status: 'error',
        error: articleCheckInvocationFailure(reason),
      });
    }
  });
  ipcMain.handle('article:check-runs-list', (_event, raw) =>
    articleCheckRunsPageSchema.parse(database.listArticleCheckRuns(articleCheckRunsListInputSchema.parse(raw))),
  );
  ipcMain.handle('article:check-run-apply', (_event, raw) =>
    articleCheckRunApplyResultSchema.parse(database.applyArticleCheckRun(articleCheckRunApplyInputSchema.parse(raw))),
  );
  ipcMain.handle('article:form-add', (_event, raw) => database.addArticleForm(articleFormAddInputSchema.parse(raw)));
  ipcMain.handle('article:form-create', (_event, raw) =>
    database.createArticleForm(articleFormCreateInputSchema.parse(raw)),
  );
  ipcMain.handle('article:rename', (_event, raw) => database.renameArticle(articleRenameInputSchema.parse(raw)));
  ipcMain.handle('article:move', (_event, raw) => database.moveArticle(articleMoveInputSchema.parse(raw)));
  ipcMain.handle('article:set-archived', (_event, raw) =>
    database.setArticleArchived(articleSetArchivedInputSchema.parse(raw)),
  );
  ipcMain.handle('article:copy-for-wechat', (_event, raw) =>
    articleWechatCopy.copy(articleCopyForWechatInputSchema.parse(raw)),
  );
  ipcMain.handle('article:export-markdown', (_event, raw) =>
    articleExports.exportMarkdown(articleExportMarkdownInputSchema.parse(raw)),
  );
  ipcMain.handle('creations:delete', (_event, raw) => database.deleteCreation(id.parse(raw)));
  ipcMain.handle('materials:add-to-destinations', (_event, raw) =>
    database.addMaterialsToDestinations(materialDestinationsAddSchema.parse(raw)),
  );
  ipcMain.handle('assets:choose-references', async () => {
    const result = await chooseFile({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }],
    });
    if (result.canceled) return { assets: [] };
    if (result.filePaths.length > 8) throw new Error('Import supports at most 8 images');
    const rows = await referenceStages.stageFiles(result.filePaths);
    const stageIds = rows.flatMap((row) => row.item.stageId ?? []);
    const invalid = rows.find((row) => row.state === 'INVALID');
    if (invalid) {
      await referenceStages.discard(stageIds);
      throw new Error(`Invalid ${invalid.item.mimeType} image: ${invalid.item.name}`);
    }
    return { assets: stageIds.length ? await referenceStages.importReferences('UPLOAD', stageIds) : [] };
  });
  ipcMain.handle('codex:health', () => codex.refreshHealth());
  ipcMain.handle('codex:open-thread', (_event, rawThreadId) => {
    const threadId = codexThreadIdSchema.parse(rawThreadId);
    return shell.openExternal(codexThreadHref(threadId));
  });
  ipcMain.handle('agent:history', (_event, raw) =>
    database.listCreatorAgentTurnPage(creatorAgentHistorySchema.parse(raw)),
  );
  ipcMain.handle('agent:chat', async (_event, raw) => {
    const parsedRequest = creatorAgentChatSchema.parse(raw);
    const attachmentAssetIds = [...new Set(parsedRequest.attachmentAssetIds)];
    const request = { ...parsedRequest, attachmentAssetIds };
    const imagePaths = database.getReferencePaths(attachmentAssetIds);
    if (imagePaths.length !== attachmentAssetIds.length) {
      throw new Error('One or more conversation image attachments are unavailable');
    }
    const history = database.listRecentCreatorAgentChatTurns(request.scope, 20);
    const { scope: _scope, attachmentAssetIds: _attachmentAssetIds, ...input } = request;
    return codex.chat({ scope: request.scope, request, input, history, imagePaths });
  });
  ipcMain.handle('agent:assist', async (_event, raw) => {
    return runAssistantRequest(creatorAgentAssistSchema.parse(raw));
  });
  ipcMain.handle('assistant-proposal:expire', (_event, rawRunId, rawContextKey) =>
    database.expireAssistantProposal(id.parse(rawRunId), z.string().min(1).max(200).parse(rawContextKey)),
  );
  ipcMain.handle('assistant-proposal:revalidate', (_event, rawRunId, rawContextKey) =>
    database.revalidateAssistantProposal(id.parse(rawRunId), z.string().min(1).max(200).parse(rawContextKey)),
  );
  ipcMain.handle('assistant-proposal:adopt', (_event, raw) =>
    database.adoptAssistantProposal(assistantProposalAdoptionSchema.parse(raw)),
  );
  ipcMain.handle('assistant-proposal:close', (_event, rawRunId) => database.closeAssistantProposal(id.parse(rawRunId)));
  ipcMain.handle('assistant-run:dismiss', (_event, rawRunId) => database.dismissAssistantRun(id.parse(rawRunId)));
  ipcMain.handle('codex:suggest-titles', (_event, raw) => runTitleRequest(titleSchema.parse(raw)));
  ipcMain.handle('prompt-series:rename', (_event, raw) => database.renamePromptSeries(renameSeriesSchema.parse(raw)));
  ipcMain.handle('prompt-series:delete', (_event, raw) => database.deletePromptSeries(deleteSeriesSchema.parse(raw)));
  ipcMain.handle('prompt-series:output-remove', (_event, raw) =>
    database.removePromptSeriesOutput(promptSeriesOutputRemoveInputSchema.parse(raw)),
  );
  ipcMain.handle('prompt-series:cover-set', (_event, raw) =>
    database.setPromptSeriesCover(promptSeriesCoverSetInputSchema.parse(raw)),
  );
  ipcMain.handle('creation-albums:rename', (_event, raw) =>
    database.renameCreationAlbum(creationAlbumRenameSchema.parse(raw)),
  );
  ipcMain.handle('material-collections:create-from-source', (_event, raw) =>
    database.createMaterialCollectionFromSource(materialCollectionCreateFromSourceSchema.parse(raw)),
  );
}
