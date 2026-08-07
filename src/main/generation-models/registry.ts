import type { ImageGenerationRouteDto } from '@/shared/contracts';
import type { GenerationProvider, ImageGenerationRoute } from '@/main/generation-models/types';

function isProvider(source: ImageGenerationRoute | GenerationProvider): source is GenerationProvider {
  return 'routes' in source;
}

export class ImageGenerationRouteRegistry {
  private readonly byKey = new Map<string, ImageGenerationRoute>();

  constructor(sources: Array<ImageGenerationRoute | GenerationProvider>) {
    for (const source of sources) {
      const routes = isProvider(source) ? source.routes() : [source];
      for (const route of routes) {
        if (isProvider(source) && route.descriptor.providerKey !== source.key) {
          throw new Error(`Image-generation route provider mismatch: ${route.descriptor.key}`);
        }
        const key = route.descriptor.key;
        if (this.byKey.has(key)) throw new Error(`Duplicate image-generation route: ${key}`);
        this.byKey.set(key, route);
      }
    }
  }

  list(): ImageGenerationRouteDto[] {
    return [...this.byKey.values()].map((route) => route.descriptor);
  }

  get(routeKey: string): ImageGenerationRoute {
    const route = this.byKey.get(routeKey);
    if (!route) throw new Error(`Unknown image-generation route: ${routeKey}`);
    return route;
  }
}
