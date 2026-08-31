import type { BootstrapDto, WorkspaceTarget } from '@/shared/contracts';
import {
  initialAppLocation,
  type AppLocation,
  type CreatorLocation,
  type DictionaryLocation,
} from '@/renderer/components/app/app-navigation';

function persistedCreatorLocation(location: CreatorLocation): WorkspaceTarget & { kind: 'creator' } {
  switch (location.surface) {
    case 'new-creation':
      return { kind: 'creator', location: { surface: location.surface, albumId: location.albumId } };
    case 'creation-draft':
      return { kind: 'creator', location: { surface: location.surface, draftId: location.draftId } };
    case 'existing-creation':
      return {
        kind: 'creator',
        location: {
          surface: location.surface,
          seriesId: location.seriesId,
          assetId: location.assetId,
          ...(location.versionId ? { versionId: location.versionId } : {}),
          ...(location.workspace ? { workspace: location.workspace } : {}),
        },
      };
    default:
      return { kind: 'creator', location };
  }
}

function persistedDictionaryLocation(location: DictionaryLocation): WorkspaceTarget & { kind: 'dictionary' } {
  if (location.surface === 'detail' || location.surface === 'edit') {
    return { kind: 'dictionary', location: { surface: location.surface, termId: location.termId } };
  }
  return { kind: 'dictionary', location };
}

export function appLocationToWorkspaceTarget(location: AppLocation): WorkspaceTarget {
  switch (location.view) {
    case 'creator':
      return persistedCreatorLocation(location.creator);
    case 'documents':
      return {
        kind: 'documents',
        collection: location.documents.collection,
        documentId: location.documents.documentId,
      };
    case 'dictionary':
      return persistedDictionaryLocation(location.dictionary);
    case 'gallery':
      return { kind: 'gallery', location: location.gallery };
    case 'companion':
      return { kind: 'companion' };
    case 'codexImages':
    case 'packs':
      return { kind: 'extensions', view: location.view, ...location.extensions };
    case 'transitionShowcase':
      return { kind: 'transition-showcase' };
    case 'aiCenter':
      return { kind: 'ai-center', ...location.aiCenter };
    case 'contentManagement':
      return { kind: 'content-management' };
  }
}

export function workspaceTargetToAppLocation(target: WorkspaceTarget): AppLocation {
  switch (target.kind) {
    case 'creator':
      return { ...initialAppLocation, view: 'creator', creator: target.location };
    case 'documents':
      return {
        ...initialAppLocation,
        view: 'documents',
        documents: { collection: target.collection, documentId: target.documentId },
      };
    case 'dictionary': {
      let dictionary: DictionaryLocation;
      if (target.location.surface === 'detail' || target.location.surface === 'edit') {
        dictionary = { surface: target.location.surface, termId: target.location.termId, browseContext: null };
      } else if (target.location.surface === 'classifications') {
        dictionary = { surface: 'classifications', classificationId: target.location.classificationId };
      } else {
        dictionary = { surface: 'overview' };
      }
      return {
        ...initialAppLocation,
        view: 'dictionary',
        dictionary,
      };
    }
    case 'gallery':
      return { ...initialAppLocation, view: 'gallery', gallery: target.location };
    case 'companion':
      return { ...initialAppLocation, view: 'companion' };
    case 'extensions':
      return {
        ...initialAppLocation,
        view: target.view,
        extensions: { tab: target.tab, pluginId: target.pluginId, packId: target.packId },
      };
    case 'transition-showcase':
      return { ...initialAppLocation, view: 'transitionShowcase' };
    case 'ai-center':
      return {
        ...initialAppLocation,
        view: 'aiCenter',
        aiCenter: { tab: target.tab, recordId: target.recordId },
      };
    case 'content-management':
      return { ...initialAppLocation, view: 'contentManagement' };
  }
}

function normalizeCreatorLocation(location: CreatorLocation, data: BootstrapDto): CreatorLocation {
  switch (location.surface) {
    case 'existing-creation':
      return data.series.some((series) => series.id === location.seriesId) ? location : { surface: 'default' };
    case 'article':
      return data.articles?.some((article) => article.id === location.articleId) ? location : { surface: 'default' };
    case 'social-post':
      return data.socialPosts?.some((post) => post.id === location.postId) ? location : { surface: 'default' };
    case 'inspiration-stash':
      return data.inspirationStashes?.some((stash) => stash.id === location.stashId)
        ? location
        : { surface: 'default' };
    case 'image-breakdown':
      return data.imageBreakdowns?.some((breakdown) => breakdown.id === location.breakdownId)
        ? location
        : { surface: 'default' };
    case 'evaluation-suite':
      return data.evaluationSuites?.some((suite) => suite.id === location.suiteId) ? location : { surface: 'default' };
    case 'idea-creation':
      return data.creations?.some((creation) => creation.id === location.creationId)
        ? location
        : { surface: 'default' };
    case 'album-detail':
      return data.albums.some((album) => album.id === location.albumId) ? location : { surface: 'default' };
    case 'new-creation':
      return location.albumId && !data.albums.some((album) => album.id === location.albumId)
        ? { ...location, albumId: null }
        : location;
    default:
      return location;
  }
}

export function normalizeWorkspaceTarget(target: WorkspaceTarget, data: BootstrapDto): AppLocation {
  const location = workspaceTargetToAppLocation(target);
  if (location.view === 'creator') {
    return { ...location, creator: normalizeCreatorLocation(location.creator, data) };
  }
  if (location.view === 'dictionary') {
    const dictionary = location.dictionary;
    if (
      (dictionary.surface === 'detail' || dictionary.surface === 'edit') &&
      !data.terms.some((term) => term.id === dictionary.termId)
    ) {
      return { ...location, dictionary: { surface: 'overview' } };
    }
  }
  if (location.view === 'gallery') {
    const collection = location.gallery.collection;
    if (collection.kind === 'album' && !data.albums.some((album) => album.id === collection.albumId)) {
      return {
        ...location,
        gallery: { collection: { kind: 'all' }, selectedMaterialKey: null, requestedMaterialId: null },
      };
    }
  }
  return location;
}

export function workspaceLocationKey(location: AppLocation) {
  return JSON.stringify(appLocationToWorkspaceTarget(location));
}

export function workspaceTabTitle(
  location: AppLocation,
  data: BootstrapDto,
  labels: Record<AppLocation['view'] | 'settings', string>,
) {
  if (location.view === 'creator') {
    const creator = location.creator;
    if (creator.surface === 'existing-creation') {
      return data.series.find((series) => series.id === creator.seriesId)?.title || labels.creator;
    }
    if (creator.surface === 'creation-draft') {
      return data.creationDraft?.id === creator.draftId ? data.creationDraft.title || labels.creator : labels.creator;
    }
    if (creator.surface === 'article') {
      return data.articles?.find((article) => article.id === creator.articleId)?.content.title || labels.creator;
    }
    if (creator.surface === 'social-post') {
      return data.socialPosts?.find((post) => post.id === creator.postId)?.content.title || labels.creator;
    }
    if (creator.surface === 'inspiration-stash') {
      return data.inspirationStashes?.find((stash) => stash.id === creator.stashId)?.title || labels.creator;
    }
  }
  if (location.view === 'dictionary') {
    const dictionary = location.dictionary;
    if (dictionary.surface === 'detail' || dictionary.surface === 'edit') {
      return data.terms.find((term) => term.id === dictionary.termId)?.title || labels.dictionary;
    }
  }
  return location.view === 'contentManagement' ? labels.settings : labels[location.view];
}
