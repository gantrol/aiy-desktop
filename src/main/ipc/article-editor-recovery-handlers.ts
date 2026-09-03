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

async function mutation(operation: () => Promise<void>): Promise<ArticleEditorRecoveryMutationResult> {
  try {
    await operation();
    return articleEditorRecoveryMutationResultSchema.parse({ status: 'ok' });
  } catch (reason) {
    return articleEditorRecoveryMutationResultSchema.parse({ status: 'error', message: errorMessage(reason) });
  }
}

export function registerArticleEditorRecoveryIpc(ipcMain: IpcHandlerRegistrar, recovery: ArticleEditorRecoveryStore) {
  ipcMain.handle('article-editor-recovery:list', async (_event, raw) => {
    let result: ArticleEditorRecoveryListResult;
    try {
      result = {
        status: 'ok',
        checkpoints: await recovery.list(articleEditorRecoveryScopeSchema.parse(raw)),
      };
    } catch (reason) {
      result = { status: 'error', message: errorMessage(reason) };
    }
    return articleEditorRecoveryListResultSchema.parse(result);
  });
  ipcMain.handle('article-editor-recovery:write', (_event, raw) =>
    mutation(() => recovery.write(articleEditorRecoveryCheckpointSchema.parse(raw))),
  );
  ipcMain.handle('article-editor-recovery:remove', (_event, raw) =>
    mutation(() => recovery.remove(articleEditorRecoveryIdentitySchema.parse(raw))),
  );
}
