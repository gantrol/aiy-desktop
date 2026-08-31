import type { ArticleEditorRecoveryStore } from '@/main/app/article-editor-recovery-store';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
import {
  articleEditorRecoveryCheckpointSchema,
  articleEditorRecoveryIdentitySchema,
  articleEditorRecoveryListResultSchema,
  articleEditorRecoveryMutationResultSchema,
  articleEditorRecoveryScopeSchema,
  type ArticleEditorRecoveryListResult,
  type ArticleEditorRecoveryMutationResult,
} from '@/shared/contracts/article-editor-recovery';

function errorMessage(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.slice(0, 2_000) || 'Article editor recovery persistence failed';
}

function mutation(operation: () => void): ArticleEditorRecoveryMutationResult {
  try {
    operation();
    return articleEditorRecoveryMutationResultSchema.parse({ status: 'ok' });
  } catch (reason) {
    return articleEditorRecoveryMutationResultSchema.parse({ status: 'error', message: errorMessage(reason) });
  }
}

export function registerArticleEditorRecoveryIpc(ipcMain: IpcHandlerRegistrar, recovery: ArticleEditorRecoveryStore) {
  ipcMain.on('article-editor-recovery:list', (event, raw) => {
    let result: ArticleEditorRecoveryListResult;
    try {
      result = {
        status: 'ok',
        checkpoints: recovery.list(articleEditorRecoveryScopeSchema.parse(raw)),
      };
    } catch (reason) {
      result = { status: 'error', message: errorMessage(reason) };
    }
    event.returnValue = articleEditorRecoveryListResultSchema.parse(result);
  });
  ipcMain.on('article-editor-recovery:write', (event, raw) => {
    event.returnValue = mutation(() => recovery.write(articleEditorRecoveryCheckpointSchema.parse(raw)));
  });
  ipcMain.on('article-editor-recovery:remove', (event, raw) => {
    event.returnValue = mutation(() => recovery.remove(articleEditorRecoveryIdentitySchema.parse(raw)));
  });
}
