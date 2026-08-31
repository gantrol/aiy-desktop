import type { RendererEventDispatcher } from '@/main/app/renderer-event-dispatcher';
import type { ArticleDeliveryJobChangedEvent, ModelWorkerStatusDto } from '@/shared/contracts';

export function createLibraryContextRendererEvents(rendererEvents: RendererEventDispatcher, isActive: () => boolean) {
  return {
    articleDeliveryJobChanged(event: ArticleDeliveryJobChangedEvent) {
      if (isActive()) rendererEvents.send('article-delivery:job-changed', event);
    },
    codexImagesChanged() {
      if (isActive()) rendererEvents.send('codex-generated-images:changed');
    },
    codexVisualizationsChanged() {
      if (isActive()) rendererEvents.send('codex-visualizations:changed');
    },
    modelWorkerChanged(status: ModelWorkerStatusDto) {
      if (isActive()) rendererEvents.send('model-worker:changed', status);
    },
  };
}
