import type { RendererEventDispatcher } from '@/main/app/renderer-event-dispatcher';
import type { ArticleDeliveryJobChangedEvent, ModelWorkerStatusDto } from '@/shared/contracts';
import type { ContentReferenceChanges } from '@/shared/contracts/content-reference-changes';
import type { CreationDraftsChanged } from '@/shared/contracts/creation-draft-list';

export function createLibraryContextRendererEvents(rendererEvents: RendererEventDispatcher, isActive: () => boolean) {
  return {
    creationDraftsChanged(event: CreationDraftsChanged) {
      if (isActive()) rendererEvents.send('creation-drafts:changed', event);
    },
    contentReferencesChanged(event: ContentReferenceChanges) {
      if (isActive()) rendererEvents.send('content-references:changed', event);
    },
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
