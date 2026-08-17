import type {
  GenerationProvider,
  GenerationProviderDefinition,
  ImageGenerationRoute,
} from '@/main/generation-models/types';

export class ModelBackedGenerationProvider implements GenerationProvider {
  constructor(
    readonly definition: GenerationProviderDefinition,
    private readonly entries: readonly ImageGenerationRoute[],
  ) {}

  get key() {
    return this.definition.id;
  }

  get name() {
    return this.definition.name;
  }

  routes() {
    return this.entries;
  }
}
