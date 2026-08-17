import type { ImageGenerationConcurrencyDto } from '@/shared/contracts';

export interface GenerationSchedulingIdentity {
  modelKey: string;
  maxConcurrent: number;
}

/** Independent admission limits per executable model route; there is no cross-model cap. */
export class GenerationAdmissionScheduler<Task extends GenerationSchedulingIdentity> {
  private readonly activeByModel = new Map<string, number>();
  private defaultModelLimit: number;
  private limitsByModelKey: Record<string, number> = {};

  constructor(defaultModelLimit: number) {
    this.defaultModelLimit = Math.max(1, defaultModelLimit);
  }

  configure(configuration: ImageGenerationConcurrencyDto) {
    this.defaultModelLimit = configuration.defaultMaxConcurrent;
    this.limitsByModelKey = { ...configuration.limitsByModelKey };
  }

  maxConcurrent(modelKey: string) {
    return this.limitsByModelKey[modelKey] ?? this.defaultModelLimit;
  }

  admitNext(candidates: readonly Task[]) {
    const task = candidates.find(
      (candidate) =>
        (this.activeByModel.get(candidate.modelKey) ?? 0) <
        (Number.isInteger(candidate.maxConcurrent) && candidate.maxConcurrent > 0
          ? candidate.maxConcurrent
          : this.maxConcurrent(candidate.modelKey)),
    );
    if (!task) return null;
    this.activeByModel.set(task.modelKey, (this.activeByModel.get(task.modelKey) ?? 0) + 1);
    return task;
  }

  release(task: Task) {
    const next = Math.max(0, (this.activeByModel.get(task.modelKey) ?? 1) - 1);
    if (next) this.activeByModel.set(task.modelKey, next);
    else this.activeByModel.delete(task.modelKey);
  }

  clear() {
    this.activeByModel.clear();
  }
}
