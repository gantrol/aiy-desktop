import type { DictionaryBrowseContext } from '@/renderer/components/dictionary/dictionary-navigation';
import type { CreationRelationFilter } from '@/shared/contracts';
import type { GifWorkspaceState } from '@/shared/contracts/gif-making';
import type { AppView } from '@/renderer/components/app/AppSidebar';

export type NavigationMode = 'push' | 'replace';
export type HistoryNavigationDirection = 'back' | 'forward';
export type HistoryNavigationGuard = (direction: HistoryNavigationDirection, continueNavigation: () => void) => boolean;

export type CreatorLocation =
  | {
      surface: 'animation';
      documentId: string;
      seriesId: string | null;
      step: GifWorkspaceState['step'];
      title: string;
      frameId?: string;
      candidateId?: string;
      adoptionTarget?: import('@/shared/contracts/gif-making').GifAdoptionTarget;
    }
  | { surface: 'default' }
  | { surface: 'outline'; albumId: string | null }
  | { surface: 'new-creation'; albumId: string | null; requestId?: number }
  | { surface: 'creation-draft'; draftId: string; derivedVisualId?: string; requestId?: number }
  | { surface: 'inspiration-stash'; stashId: string }
  | { surface: 'image-breakdown'; breakdownId: string }
  | { surface: 'evaluation-suite'; suiteId: string }
  | { surface: 'social-post'; postId: string }
  | { surface: 'article'; articleId: string }
  | { surface: 'idea-creation'; creationId: string }
  | {
      surface: 'existing-creation';
      seriesId: string;
      outputSeriesId?: string;
      derivedVisualId?: string;
      assetId: string | null;
      versionId?: string;
      workspace?: 'prompt' | 'annotations';
      requestId?: number;
    }
  | { surface: 'album-detail'; albumId: string };

export type DictionaryLocation =
  | { surface: 'overview' }
  | { surface: 'classifications'; classificationId: string | null }
  | {
      surface: 'detail' | 'edit';
      termId: string;
      browseContext: DictionaryBrowseContext | null;
    };

export type GalleryCollection =
  | { kind: 'all' }
  | { kind: 'creation' }
  | { kind: 'import' }
  | {
      kind: 'dictionary';
      scope: 'ALL' | 'FAVORITE';
      domainId?: string;
      typeId?: string;
      termId?: string;
    }
  | { kind: 'album'; albumId: string; creationRelation?: CreationRelationFilter };

export type GalleryDictionaryCollection = Extract<GalleryCollection, { kind: 'dictionary' }>;

export interface GalleryLocation {
  collection: GalleryCollection;
  selectedMaterialKey: string | null;
  requestedMaterialId: string | null;
}

export interface ExtensionsLocation {
  tab: 'plugins' | 'contentPacks';
  pluginId: string | null;
  packId: string | null;
}

export interface AiCenterLocation {
  tab: 'activity' | 'statistics' | 'capabilities';
  recordId: string | null;
}

export type VideoDocumentCollection = { kind: 'all' } | { kind: 'unfiled' } | { kind: 'album'; albumId: string };

export interface VideoDocumentsLocation {
  collection: VideoDocumentCollection;
  documentId: string | null;
}

export type CreatorOpenTabTarget =
  { view: 'creator'; location: CreatorLocation } | { view: 'documents'; location: VideoDocumentsLocation };

export type MaterialsReturnContext =
  | { destination: 'creator'; seriesId: string }
  | { destination: 'dictionary'; termId: string }
  | { destination: 'documents'; documentId: string; title: string };

export interface AppLocation {
  view: AppView;
  creator: CreatorLocation;
  dictionary: DictionaryLocation;
  gallery: GalleryLocation;
  extensions: ExtensionsLocation;
  aiCenter: AiCenterLocation;
  documents: VideoDocumentsLocation;
  materialsReturnContext: MaterialsReturnContext | null;
}

export const initialAppLocation: AppLocation = {
  view: 'creator',
  creator: { surface: 'default' },
  dictionary: { surface: 'overview' },
  gallery: {
    collection: { kind: 'all' },
    selectedMaterialKey: null,
    requestedMaterialId: null,
  },
  extensions: {
    tab: 'plugins',
    pluginId: null,
    packId: null,
  },
  aiCenter: {
    tab: 'activity',
    recordId: null,
  },
  documents: {
    collection: { kind: 'all' },
    documentId: null,
  },
  materialsReturnContext: null,
};

export function navigationLocationKey(location: unknown) {
  // Restore, persistence, and live navigation build the same location in different
  // property orders. Those differences must not trigger another workspace restore.
  return JSON.stringify(location, (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    );
  });
}

export function sameAppLocation(left: AppLocation, right: AppLocation) {
  return navigationLocationKey(left) === navigationLocationKey(right);
}
