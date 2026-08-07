import type { GenerationTargetInput } from '@/shared/contracts';

export interface GenerationBatchPlan {
  modelCount: number;
  totalCount: number;
  uniformRepeatCount: number | null;
}

export function generationBatchPlan(targets: readonly GenerationTargetInput[]): GenerationBatchPlan {
  const firstCount = targets[0]?.count ?? null;
  const uniformRepeatCount =
    firstCount !== null && targets.every((target) => target.count === firstCount) ? firstCount : null;

  return {
    modelCount: targets.length,
    totalCount: targets.reduce((total, target) => total + target.count, 0),
    uniformRepeatCount,
  };
}
