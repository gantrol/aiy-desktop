import { shell, type OpenDialogOptions, type OpenDialogReturnValue } from 'electron';
import { z } from 'zod';
import type { CodexService } from '@/main/assistant/codex-service';
import { CreatorImageStagingService } from '@/main/creations/creator-image-staging';
import type { LibraryDatabase } from '@/main/database';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import {
  promptSeriesCoverSetInputSchema,
  promptSeriesOutputRemoveInputSchema,
} from '@/shared/contracts/creation-output-presentation';
import {
  assistantProposalAdoptionSchema,
  creationDraftCommitSchema,
  creationDraftSaveSchema,
  creationDraftStartSchema,
  creationGroupRenameSchema,
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
}

export function registerCreationAssistantIpc({
  ipcMain,
  database,
  codex,
  chooseFile,
  runAssistantRequest,
  runTitleRequest,
}: CreationAssistantIpcOptions) {
  const referenceStages = new CreatorImageStagingService(() => database);
  ipcMain.handle('creation-draft:start', (_event, raw) =>
    database.startCreationDraft(creationDraftStartSchema.parse(raw)),
  );
  ipcMain.handle('creation-draft:save', (_event, raw) =>
    database.saveCreationDraft(creationDraftSaveSchema.parse(raw)),
  );
  ipcMain.handle('creation-draft:commit', (_event, raw) =>
    database.commitCreationDraft(creationDraftCommitSchema.parse(raw)),
  );
  ipcMain.handle('creation-input-stashes:list', (_event, raw) =>
    database.listCreationInputStashes(creatorAgentScopeSchema.parse(raw)),
  );
  ipcMain.handle('creation-input-stash:create', (_event, raw) =>
    database.createCreationInputStash(creationInputStashCreateSchema.parse(raw)),
  );
  ipcMain.handle('creations:delete', (_event, raw) => database.deleteCreation(id.parse(raw)));
  ipcMain.handle('materials:add-to-destinations', (_event, raw) =>
    database.addMaterialsToDestinations(materialDestinationsAddSchema.parse(raw)),
  );
  ipcMain.handle('assets:choose-references', async () => {
    const result = await chooseFile({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
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
    const threadId = id.parse(rawThreadId);
    return shell.openExternal(`codex://threads/${encodeURIComponent(threadId)}`);
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
  ipcMain.handle('creation-groups:rename', (_event, raw) =>
    database.renameCreationGroup(creationGroupRenameSchema.parse(raw)),
  );
  ipcMain.handle('material-collections:create-from-source', (_event, raw) =>
    database.createMaterialCollectionFromSource(materialCollectionCreateFromSourceSchema.parse(raw)),
  );
}
