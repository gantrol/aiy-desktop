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

interface WorkspaceTabTitleLabels {
  views: Record<AppLocation['view'] | 'settings', string>;
  newCreation: string;
  creationKinds: {
    creationAlbum: string;
    promptSeries: string;
    imageBreakdown: string;
    ideaCreation: string;
    inspirationStash: string;
    evaluationSuite: string;
    socialPost: string;
    article: string;
    videoDocument: string;
  };
}

function displayTitle(value: string | null | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function newCreationTabTitle(albumId: string | null, data: BootstrapDto, labels: WorkspaceTabTitleLabels) {
  const albumTitle = albumId ? data.albums.find((album) => album.id === albumId)?.title.trim() : null;
  return albumTitle ? `${labels.newCreation} · ${albumTitle}` : labels.newCreation;
}

function creatorTabTitle(creator: CreatorLocation, data: BootstrapDto, labels: WorkspaceTabTitleLabels) {
  const kinds = labels.creationKinds;
  switch (creator.surface) {
    case 'default':
      return labels.views.creator;
    case 'new-creation':
      return newCreationTabTitle(creator.albumId, data, labels);
    case 'creation-draft':
      return data.creationDraft?.id === creator.draftId
        ? displayTitle(data.creationDraft.title, labels.newCreation)
        : labels.newCreation;
    case 'inspiration-stash':
      return displayTitle(
        data.inspirationStashes?.find((stash) => stash.id === creator.stashId)?.title,
        kinds.inspirationStash,
      );
    case 'image-breakdown':
      return displayTitle(
        data.imageBreakdowns?.find((breakdown) => breakdown.id === creator.breakdownId)?.title,
        kinds.imageBreakdown,
      );
    case 'evaluation-suite':
      return displayTitle(
        data.evaluationSuites?.find((suite) => suite.id === creator.suiteId)?.content.title,
        kinds.evaluationSuite,
      );
    case 'social-post':
      return displayTitle(
        data.socialPosts?.find((post) => post.id === creator.postId)?.content.title,
        kinds.socialPost,
      );
    case 'article':
      return displayTitle(
        data.articles?.find((article) => article.id === creator.articleId)?.content.title,
        kinds.article,
      );
    case 'idea-creation':
      return displayTitle(
        data.creations?.find((creation) => creation.id === creator.creationId)?.title,
        kinds.ideaCreation,
      );
    case 'existing-creation':
      return displayTitle(data.series.find((series) => series.id === creator.seriesId)?.title, kinds.promptSeries);
    case 'album-detail':
      return displayTitle(data.albums.find((album) => album.id === creator.albumId)?.title, kinds.creationAlbum);
  }
}

export function workspaceTabTitle(location: AppLocation, data: BootstrapDto, labels: WorkspaceTabTitleLabels) {
  if (location.view === 'creator') {
    return creatorTabTitle(location.creator, data, labels);
  }
  if (location.view === 'documents') {
    const returnContext = location.materialsReturnContext;
    if (
      location.documents.documentId &&
      returnContext?.destination === 'documents' &&
      returnContext.documentId === location.documents.documentId
    ) {
      return displayTitle(returnContext.title, labels.creationKinds.videoDocument);
    }
    if (location.documents.collection.kind === 'album') {
      const albumId = location.documents.collection.albumId;
      return displayTitle(data.albums.find((album) => album.id === albumId)?.title, labels.views.documents);
    }
  }
  if (location.view === 'dictionary') {
    const dictionary = location.dictionary;
    if (dictionary.surface === 'detail' || dictionary.surface === 'edit') {
      return displayTitle(data.terms.find((term) => term.id === dictionary.termId)?.title, labels.views.dictionary);
    }
    if (dictionary.surface === 'classifications' && dictionary.classificationId) {
      const name = data.categories.find((category) => category.id === dictionary.classificationId)?.name;
      return displayTitle(name?.split(' / ').at(-1), labels.views.dictionary);
    }
  }
  if (location.view === 'gallery' && location.gallery.collection.kind === 'album') {
    const albumId = location.gallery.collection.albumId;
    return displayTitle(data.albums.find((album) => album.id === albumId)?.title, labels.views.gallery);
  }
  if (location.view === 'contentManagement') {
    return labels.views.settings;
  }
  return labels.views[location.view];
}

export function workspaceLocationCanSplit(location: AppLocation) {
  if (location.view === 'creator') {
    return !(
      location.creator.surface === 'default' ||
      location.creator.surface === 'new-creation' ||
      location.creator.surface === 'creation-draft'
    );
  }
  if (location.view === 'documents') {
    return location.documents.documentId === null;
  }
  if (location.view === 'dictionary') {
    return location.dictionary.surface !== 'edit';
  }
  return true;
}
