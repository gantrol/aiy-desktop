import type { DictionaryBrowseContext } from '@/renderer/components/dictionary/dictionary-navigation';
import type { CreationRelationFilter } from '@/shared/contracts';
import type { AppView } from '@/renderer/components/app/AppSidebar';

export type NavigationMode = 'push' | 'replace';
export type HistoryNavigationDirection = 'back' | 'forward';
export type HistoryNavigationGuard = (direction: HistoryNavigationDirection, continueNavigation: () => void) => boolean;

export type CreatorLocation =
  | { surface: 'default' }
  | { surface: 'new-creation'; albumId: string | null; requestId?: number }
  | { surface: 'idea-creation'; creationId: string }
  | {
      surface: 'existing-creation';
      seriesId: string;
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

export type MaterialsReturnContext =
  { destination: 'creator'; seriesId: string } | { destination: 'dictionary'; termId: string };

export interface AppLocation {
  view: AppView;
  creator: CreatorLocation;
  dictionary: DictionaryLocation;
  gallery: GalleryLocation;
  extensions: ExtensionsLocation;
  aiCenter: AiCenterLocation;
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
  materialsReturnContext: null,
};

export function navigationLocationKey(location: unknown) {
  return JSON.stringify(location);
}

export function sameAppLocation(left: AppLocation, right: AppLocation) {
  return navigationLocationKey(left) === navigationLocationKey(right);
}
