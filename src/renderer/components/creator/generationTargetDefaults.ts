import type { BootstrapDto, GenerationRunDto, GenerationTargetInput, PromptVersionDto } from '@/shared/contracts';

type GenerationRouteBootstrap = Pick<BootstrapDto, 'creationDraft' | 'imageGenerationRoutes'>;
type LegacyGenerationRouteBootstrap = Pick<BootstrapDto, 'creationDraft'> & {
  /** @deprecated Compatibility input only. Product code uses imageGenerationRoutes. */
  generationModels: BootstrapDto['imageGenerationRoutes'];
};

function copyTargets(targets: readonly GenerationTargetInput[]) {
  return targets.map((target) => ({ ...target }));
}

export function latestVersionGenerationRun(
  version: Pick<PromptVersionDto, 'id' | 'parentVersionId' | 'runs'> | null | undefined,
  versions: readonly Pick<PromptVersionDto, 'id' | 'parentVersionId' | 'runs'>[] = [],
): GenerationRunDto | undefined {
  const byId = new Map(versions.map((candidate) => [candidate.id, candidate]));
  const visited = new Set<string>();
  let candidate = version;
  while (candidate && !visited.has(candidate.id)) {
    visited.add(candidate.id);
    if (candidate.runs[0]) return candidate.runs[0];
    candidate = candidate.parentVersionId ? byId.get(candidate.parentVersionId) : undefined;
  }
  return undefined;
}

export function latestVersionGenerationTargets(
  version: Pick<PromptVersionDto, 'id' | 'parentVersionId' | 'runs'> | null | undefined,
  versions: readonly Pick<PromptVersionDto, 'id' | 'parentVersionId' | 'runs'>[] = [],
): GenerationTargetInput[] {
  const latestRun = latestVersionGenerationRun(version, versions);
  return latestRun ? [{ modelKey: latestRun.modelKey, count: 1, quality: latestRun.quality }] : [];
}

export function initialGenerationTargets(
  data: GenerationRouteBootstrap | LegacyGenerationRouteBootstrap,
  preferredTargets: readonly GenerationTargetInput[] = [],
): GenerationTargetInput[] {
  const routes = 'imageGenerationRoutes' in data ? data.imageGenerationRoutes : data.generationModels;
  if (data.creationDraft?.modelTargets.length) return data.creationDraft.modelTargets;
  if (data.creationDraft?.selectedModelKeys.length) {
    return data.creationDraft.selectedModelKeys.map((modelKey) => ({
      modelKey,
      count: data.creationDraft?.repeatCount ?? 1,
      quality: data.creationDraft?.quality ?? 'low',
    }));
  }
  if (preferredTargets.length) return copyTargets(preferredTargets);
  const preferredRoute =
    routes.find((route) => route.state === 'READY' && !route.internal) ??
    routes.find((route) => route.state === 'READY') ??
    routes.find((route) => !route.internal) ??
    routes[0];
  const selectedRouteKeys = preferredRoute ? [preferredRoute.key] : [];
  return selectedRouteKeys.map((modelKey) => ({
    modelKey,
    count: data.creationDraft?.repeatCount ?? 1,
    quality: data.creationDraft?.quality ?? 'low',
  }));
}
