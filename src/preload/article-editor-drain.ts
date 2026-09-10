import { ipcRenderer } from 'electron';
import {
  ARTICLE_EDITOR_DRAIN_CANCEL,
  ARTICLE_EDITOR_DRAIN_REQUEST,
  ARTICLE_EDITOR_DRAIN_RESULT,
} from '@/shared/article-editor-drain';

type DrainListener = (draining: boolean) => Promise<boolean>;
let listener: DrainListener | null = null;
let activeRequest: string | null = null;
ipcRenderer.on(ARTICLE_EDITOR_DRAIN_REQUEST, async (_event, requestId: unknown) => {
  if (typeof requestId !== 'string' || requestId.length > 200) return;
  activeRequest = requestId;
  let saved = false;
  try {
    saved = await (listener?.(true) ?? Promise.resolve(true));
  } catch {
    /* Keep the window open. */
  }
  if (activeRequest === requestId) ipcRenderer.send(ARTICLE_EDITOR_DRAIN_RESULT, { requestId, saved });
});
ipcRenderer.on(ARTICLE_EDITOR_DRAIN_CANCEL, (_event, requestId: unknown) => {
  if (activeRequest !== requestId) return;
  activeRequest = null;
  void listener?.(false);
});

export function onArticleEditorDrain(next: DrainListener) {
  listener = next;
  return () => {
    if (listener === next) listener = null;
  };
}
