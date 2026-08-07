import type { GenerationProvider, ImageGenerationRoute } from '@/main/generation-models/types';

export class ModelBackedGenerationProvider implements GenerationProvider {
  constructor(
    readonly key: string,
    readonly name: string,
    private readonly entries: readonly ImageGenerationRoute[],
  ) {}

  routes() {
    return this.entries;
  }
}
