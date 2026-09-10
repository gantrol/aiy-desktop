import type { WorkspaceVisualResumeDto } from '@/shared/contracts/workspace-layout';
import type { AppLocation } from '@/renderer/components/app/app-navigation';

export function rememberVisualWorkspace(entries: WorkspaceVisualResumeDto[], location: AppLocation) {
  const view = location.creator;
  if (location.view !== 'creator' || view.surface !== 'existing-creation' || !view.derivedVisualId || !view.versionId)
    return entries;
  const next: WorkspaceVisualResumeDto = {
    visualId: view.derivedVisualId,
    seriesId: view.seriesId,
    versionId: view.versionId,
    assetId: view.assetId,
    ...(view.outputSeriesId && view.outputSeriesId !== view.seriesId ? { outputSeriesId: view.outputSeriesId } : {}),
  };
  const latest = entries.at(-1);
  if (
    latest?.visualId === next.visualId &&
    latest.seriesId === next.seriesId &&
    latest.versionId === next.versionId &&
    latest.assetId === next.assetId &&
    latest.outputSeriesId === next.outputSeriesId
  )
    return entries;
  return [...entries.filter((entry) => entry.visualId !== next.visualId).slice(-99), next];
}
