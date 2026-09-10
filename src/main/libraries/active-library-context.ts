import type { AssistantService } from '@/main/assistant/assistant-service';
import type { CodexService } from '@/main/assistant/codex-service';
import type { CodexContentService } from '@/main/extensions/codex-content/service';
import type { LibraryDatabase } from '@/main/database';
import type { CodexImageDiscovery } from '@/main/extensions/codex-image-discovery';
import type { CodexVisualizationDiscovery } from '@/main/extensions/codex-visualization-discovery';
import type { ArticleDeliveryJobCoordinator } from '@/main/extensions/article-delivery/job-coordinator';
import type { ExtensionRegistry } from '@/main/extensions/registry';
import type { MediaThumbnailCache } from '@/main/media/media-thumbnail-cache';
import type { LibraryContextState } from '@/main/libraries/library-context-lifecycle';
import type { LibraryDescriptor } from '@/main/libraries/library-registry';
import type { BackgroundGenerationClient } from '@/main/model-worker/client';

export interface ActiveLibraryContext {
  readonly epoch: number;
  readonly state: LibraryContextState;
  library: LibraryDescriptor;
  database: LibraryDatabase;
  generation: BackgroundGenerationClient;
  codex: CodexService;
  codexContent: CodexContentService;
  assistant: AssistantService;
  imageDiscovery: CodexImageDiscovery;
  visualizationDiscovery: CodexVisualizationDiscovery;
  extensions: ExtensionRegistry;
  articleDeliveryJobs: ArticleDeliveryJobCoordinator;
  thumbnails: MediaThumbnailCache;
  acquireOperation(): () => void;
  drain(): Promise<void>;
  resume(): void;
  activate(): void;
  startBackgroundServices(): void;
  dispose(): Promise<void>;
}
