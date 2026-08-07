import type { ImageGenerationRouteDto } from '@/shared/contracts';
import type { GenerationProvider, ImageGenerationRoute } from '@/main/generation-models/types';

class CatalogImageGenerationRoute implements ImageGenerationRoute {
  constructor(
    private readonly baseDescriptor: ImageGenerationRouteDto,
    private readonly availability?: () => Pick<ImageGenerationRouteDto, 'state' | 'availabilityReason'>,
  ) {}

  get descriptor(): ImageGenerationRouteDto {
    return this.availability ? { ...this.baseDescriptor, ...this.availability() } : this.baseDescriptor;
  }

  prepareExecution(): never {
    throw new Error(`Provider is not configured: ${this.descriptor.provider}`);
  }
}

export class CatalogGenerationProvider implements GenerationProvider {
  private readonly entries: ImageGenerationRoute[];

  constructor(
    readonly key: string,
    readonly name: string,
    routes: Array<
      Omit<ImageGenerationRouteDto, 'provider' | 'providerKey' | 'state' | 'availabilityReason' | 'internal'>
    >,
    options: {
      availability?: () => Pick<ImageGenerationRouteDto, 'state' | 'availabilityReason'>;
    } = {},
  ) {
    this.entries = routes.map(
      (route) =>
        new CatalogImageGenerationRoute(
          {
            ...route,
            provider: name,
            providerKey: key,
            state: 'UNAVAILABLE',
            availabilityReason: route.releaseStage === 'PREVIEW' ? 'LIMITED_PREVIEW' : 'PROVIDER_NOT_CONFIGURED',
            internal: false,
          },
          options.availability,
        ),
    );
  }

  routes() {
    return this.entries;
  }
}
