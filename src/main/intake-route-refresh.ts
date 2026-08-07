import type { LibraryDatabase } from '@/main/database';
import type { GenerationService } from '@/main/generation-service';
import { internalLibraryRandomModelKey } from '@/main/generation-models/internal-library-random-model';
import type { IntakeCommitInput } from '@/shared/contracts';

type IntakeCommitDatabase = Pick<LibraryDatabase, 'commitIntake'>;
type IntakeRouteGeneration = Pick<GenerationService, 'imageGenerationRoutes' | 'refreshExtensions'>;

/**
 * A library import can make the internal replay route available for the first
 * time. Refresh only for that transition so normal imports stay cheap.
 */
export async function commitIntakeAndRefreshRoutes(
  database: IntakeCommitDatabase,
  generation: IntakeRouteGeneration,
  input: IntakeCommitInput,
) {
  const replayRouteNeedsRefresh = generation.imageGenerationRoutes.some(
    (route) => route.key === internalLibraryRandomModelKey && route.state !== 'READY',
  );
  const result = await database.commitIntake(input);
  if (replayRouteNeedsRefresh && result.materialIds.length > 0) {
    try {
      await generation.refreshExtensions?.();
    } catch (error) {
      console.warn('[intake] failed to refresh image-generation routes', error);
    }
  }
  return result;
}
