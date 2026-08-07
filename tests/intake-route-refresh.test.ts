import { describe, expect, it, vi } from 'vitest';
import type { LibraryDatabase } from '@/main/database';
import type { GenerationService } from '@/main/generation-service';
import { internalLibraryRandomModelKey } from '@/main/generation-models/internal-library-random-model';
import { commitIntakeAndRefreshRoutes } from '@/main/intake-route-refresh';
import type { ImageGenerationRouteDto, IntakeCommitInput, IntakeCommitResult } from '@/shared/contracts';

const input: IntakeCommitInput = { intent: 'IMPORT', source: 'UPLOAD', items: [] };

function result(materialIds: string[]): IntakeCommitResult {
  return {
    intent: 'IMPORT',
    draft: null,
    favoriteCount: 0,
    materialIds,
    imageMaterialIds: materialIds,
    linkedOutputs: [],
    albumId: null,
  };
}

function route(state: ImageGenerationRouteDto['state']): ImageGenerationRouteDto {
  return {
    key: internalLibraryRandomModelKey,
    name: 'Internal replay',
    provider: 'internal',
    providerKey: 'internal',
    modelId: internalLibraryRandomModelKey,
    state,
    availabilityReason: state === 'READY' ? null : 'Import an image first',
    releaseStage: 'INTERNAL',
    internal: true,
    maxReferenceImages: 0,
    capabilities: ['GENERATE'],
    qualityMode: 'PROVIDER_MANAGED',
    supportedQualities: [],
  };
}

function fixtures(materialIds: string[], state: ImageGenerationRouteDto['state'] = 'UNAVAILABLE') {
  const commitIntake = vi.fn().mockResolvedValue(result(materialIds));
  const refreshExtensions = vi.fn().mockResolvedValue(undefined);
  return {
    database: { commitIntake } as unknown as Pick<LibraryDatabase, 'commitIntake'>,
    generation: {
      imageGenerationRoutes: [route(state)],
      refreshExtensions,
    } as Pick<GenerationService, 'imageGenerationRoutes' | 'refreshExtensions'>,
    commitIntake,
    refreshExtensions,
  };
}

describe('intake route refresh', () => {
  it('refreshes the worker snapshot after the first material makes replay available', async () => {
    const fixture = fixtures(['material-1']);

    await expect(commitIntakeAndRefreshRoutes(fixture.database, fixture.generation, input)).resolves.toEqual(
      result(['material-1']),
    );
    expect(fixture.commitIntake).toHaveBeenCalledWith(input);
    expect(fixture.refreshExtensions).toHaveBeenCalledOnce();
  });

  it('does not refresh an already-ready route or an empty import', async () => {
    const ready = fixtures(['material-1'], 'READY');
    const empty = fixtures([]);

    await commitIntakeAndRefreshRoutes(ready.database, ready.generation, input);
    await commitIntakeAndRefreshRoutes(empty.database, empty.generation, input);

    expect(ready.refreshExtensions).not.toHaveBeenCalled();
    expect(empty.refreshExtensions).not.toHaveBeenCalled();
  });

  it('keeps a committed import when the best-effort route refresh fails', async () => {
    const fixture = fixtures(['material-1']);
    const error = new Error('worker unavailable');
    fixture.refreshExtensions.mockRejectedValue(error);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(commitIntakeAndRefreshRoutes(fixture.database, fixture.generation, input)).resolves.toEqual(
      result(['material-1']),
    );
    expect(warn).toHaveBeenCalledWith('[intake] failed to refresh image-generation routes', error);

    warn.mockRestore();
  });
});
