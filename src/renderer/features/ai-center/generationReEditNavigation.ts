import type { BootstrapDto } from '@/shared/contracts';
import type { CreatorLocation } from '@/renderer/components/app/app-navigation';

function sameVersionInputs(
  left: BootstrapDto['series'][number]['versions'][number],
  right: BootstrapDto['series'][number]['versions'][number],
) {
  return (
    left.finalPrompt === right.finalPrompt &&
    left.termPromptLocale === right.termPromptLocale &&
    JSON.stringify(left.termIds) === JSON.stringify(right.termIds) &&
    JSON.stringify(left.wordPaletteReferences) === JSON.stringify(right.wordPaletteReferences) &&
    JSON.stringify(left.referenceAssets.map((asset) => asset.id)) ===
      JSON.stringify(right.referenceAssets.map((asset) => asset.id))
  );
}

export function generationReEditLocation(data: BootstrapDto, runId: string, requestId: number): CreatorLocation | null {
  for (const series of data.series) {
    for (const version of series.versions) {
      const run = version.runs.find((candidate) => candidate.id === runId);
      if (!run) continue;
      const parent = series.versions.find((candidate) => candidate.id === version.parentVersionId);
      // Recover the intended edit surface for no-op versions created by the
      // former text-node hash drift. The historical run stays truthful (it was
      // sent as a plain generation), while "Edit again" returns to the frozen
      // parent edit and its annotations.
      const editableVersion =
        !version.sourceImageId && parent?.sourceImageId && sameVersionInputs(version, parent) ? parent : version;
      const sourceAssetId = editableVersion.sourceImageId ?? run.derivation?.sourceAssetId ?? null;
      return {
        surface: 'existing-creation',
        seriesId: series.id,
        assetId: sourceAssetId,
        versionId: editableVersion.id,
        workspace: sourceAssetId ? 'annotations' : 'prompt',
        requestId,
      };
    }
  }
  return null;
}
