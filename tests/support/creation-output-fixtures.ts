/**
 * Shared builders for creation-output structures.
 *
 * Extracted so the projection tests and the component lane construct the same
 * shapes. Each builder fills only what the contracts require and leaves the
 * interesting values to the caller, so a test reads as the case it describes
 * rather than as forty lines of scaffolding.
 */
import type { AssetDto, GenerationRunDto, PromptVersionDto } from '../../src/shared/contracts';
import type {
  CreationOutputAssetProjection,
  CreationOutputVersionGroup,
} from '../../src/renderer/components/creator/creationOutputProjection';

export function makeAsset(id: string, createdAt = '2026-08-01T00:00:00.000Z'): AssetDto {
  return {
    id,
    kind: 'GENERATED',
    width: 1024,
    height: 1024,
    mimeType: 'image/png',
    mediaUrl: `asset://${id}`,
    createdAt,
  };
}

export function makeRun(id: string, output: AssetDto | null, createdAt = '2026-08-01T00:00:00.000Z'): GenerationRunDto {
  return {
    id,
    modelKey: 'gpt-image-2',
    status: output ? 'SUCCEEDED' : 'FAILED',
    retryOfRunId: null,
    canvasPresetKey: null,
    width: 1024,
    height: 1024,
    quality: 'low',
    asset: output,
    derivation: null,
    errorMessage: output ? null : 'failed',
    createdAt,
  };
}

export function makeVersion(
  id: string,
  versionNo: number,
  createdAt = '2026-08-01T00:00:00.000Z',
  runs: GenerationRunDto[] = [],
): PromptVersionDto {
  return {
    id,
    parentVersionId: null,
    versionNo,
    manualPrompt: id,
    finalPrompt: id,
    isStructured: true,
    termPromptLocale: 'en',
    termIds: [],
    wordPaletteReferences: [],
    referenceAssets: [],
    changeSummary: id,
    createdAt,
    runs,
    promptInputSnapshot: {
      id: `snapshot-${id}`,
      sourceKind: 'COMPOSED',
      commonInput: {
        userInstruction: id,
        directTermPromptLocale: 'en',
        directTerms: [],
        recipes: [],
        directReferences: [],
      },
      contentHash: `hash-${id}`,
      createdAt,
    },
  };
}

export function makeOutput(assetId: string, runId = `run-${assetId}`): CreationOutputAssetProjection {
  const asset = makeAsset(assetId);
  return { asset, run: makeRun(runId, asset), lineageRootRunId: runId };
}

/** A major-version group with no exploration directions. */
export function makeVersionGroup(id: string, versionNo: number, assetIds: string[]): CreationOutputVersionGroup {
  return {
    id,
    versionLabel: `v${versionNo}`,
    version: makeVersion(id, versionNo),
    primaryAssets: assetIds.map((assetId) => makeOutput(assetId)),
    failedPrimaryAssets: [],
    directionStacks: [],
  };
}
