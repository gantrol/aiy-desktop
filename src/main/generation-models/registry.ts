import type { ImageGenerationRouteDto } from '@/shared/contracts';
import type { GenerationProvider, ImageGenerationRoute } from '@/main/generation-models/types';
import { assertImageGenerationRouteExecutionIdentity } from '@/shared/image-generation-route-identity';

function isProvider(source: ImageGenerationRoute | GenerationProvider): source is GenerationProvider {
  return 'routes' in source;
}

export class ImageGenerationRouteRegistry {
  private readonly entries: Array<{
    route: ImageGenerationRoute;
    providerId: string | null;
  }> = [];

  constructor(sources: Array<ImageGenerationRoute | GenerationProvider>) {
    for (const source of sources) {
      const routes = isProvider(source) ? source.routes() : [source];
      for (const route of routes) {
        this.entries.push({ route, providerId: isProvider(source) ? source.definition.id : null });
      }
    }
    this.currentEntries();
  }

  list(): ImageGenerationRouteDto[] {
    return this.currentEntries().map(({ descriptor }) => descriptor);
  }

  get(routeKey: string): ImageGenerationRoute {
    const entry = this.currentEntries().find(({ descriptor }) => descriptor.key === routeKey);
    if (!entry) throw new Error(`Unknown image-generation route: ${routeKey}`);
    return entry.route;
  }

  private currentEntries() {
    const keys = new Set<string>();
    return this.entries.map((entry) => {
      const descriptor = entry.route.descriptor;
      const identity = assertImageGenerationRouteExecutionIdentity(descriptor);
      if (entry.providerId && identity.providerId !== entry.providerId) {
        throw new Error(`Image-generation route provider mismatch: ${descriptor.key}`);
      }
      if (keys.has(descriptor.key)) throw new Error(`Duplicate image-generation route: ${descriptor.key}`);
      keys.add(descriptor.key);
      return { ...entry, descriptor };
    });
  }
}
