import type { PetalAssetFileCommand, PetalAssetFileResult } from '@/shared/contracts/petal-workspace';

/** Adapt the narrow content capability; a petal never receives the main-window API. */
export async function contentAssetFileAction(request: PetalAssetFileCommand): Promise<PetalAssetFileResult> {
  const api = window.desktopApi;
  if (!api) {
    if (!window.desktopPetals?.assetFile) throw new Error('Asset file actions are unavailable');
    return window.desktopPetals.assetFile(request);
  }
  if (request.action === 'save-as') return api.assetFileSaveAs(request.assetId);
  if (request.action === 'copy') await api.assetFileCopy(request.assetId);
  else if (request.action === 'open') await api.assetFileOpen(request.assetId);
  else await api.assetFileReveal(request.assetId);
  return { status: 'done' };
}
