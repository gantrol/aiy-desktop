import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssetDto, GalleryDictionaryFilter, GalleryListInput, MaterialAlbumDto } from '@/shared/contracts';
import { OTHER_DOMAIN, OTHER_TYPE } from '@/renderer/components/dictionary/dictionary-navigation';
import type {
  MaterialImagePickerCollection,
  MaterialImagePickerDiagnosticSink,
} from '@/renderer/components/gallery/materialImagePicker';
import { useI18n } from '@/renderer/i18n/useI18n';

export interface MaterialImagePickerMaterialImage {
  asset: AssetDto;
}

interface MaterialImagePickerMaterialState {
  images: MaterialImagePickerMaterialImage[];
  total: number;
  nextCursor: string | null;
  identity: string | null;
  requestKey: string | null;
  stale: boolean;
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  failed: boolean;
}

interface MaterialImagePickerAlbumState {
  albums: MaterialAlbumDto[];
  identity: string | null;
  requestKey: string | null;
  stale: boolean;
  loaded: boolean;
  loading: boolean;
  failed: boolean;
}

const initialMaterialState: MaterialImagePickerMaterialState = {
  images: [],
  total: 0,
  nextCursor: null,
  identity: null,
  requestKey: null,
  stale: false,
  loaded: false,
  loading: false,
  loadingMore: false,
  failed: false,
};
const initialAlbumState: MaterialImagePickerAlbumState = {
  albums: [],
  identity: null,
  requestKey: null,
  stale: false,
  loaded: false,
  loading: false,
  failed: false,
};

function dictionaryFilter(collection: MaterialImagePickerCollection): GalleryDictionaryFilter | undefined {
  if (collection.kind !== 'dictionary') return undefined;
  const facetValueIds: string[] = [];
  const missingFacetSystemRoles: GalleryDictionaryFilter['missingFacetSystemRoles'] = [];
  if (collection.domainId === OTHER_DOMAIN) missingFacetSystemRoles.push('PRIMARY_CLASSIFICATION');
  else if (collection.domainId) facetValueIds.push(collection.domainId);
  if (collection.typeId === OTHER_TYPE) missingFacetSystemRoles.push('SECONDARY_CLASSIFICATION');
  else if (collection.typeId) facetValueIds.push(collection.typeId);
  if (!facetValueIds.length && !missingFacetSystemRoles.length && !collection.termId) return undefined;
  return { facetValueIds, missingFacetSystemRoles, termId: collection.termId };
}

function listInput(
  collection: MaterialImagePickerCollection,
  locale: GalleryListInput['locale'],
  cursor: string | null,
  knownTotal?: number,
): GalleryListInput {
  return {
    locale,
    source: collection.kind === 'dictionary' ? 'DICTIONARY' : 'LIBRARY',
    dictionary: dictionaryFilter(collection),
    albumId: collection.kind === 'album' ? collection.albumId : undefined,
    unratedDimensions: [],
    cursor,
    knownTotal,
    limit: 60,
  };
}

function imageItems(items: Awaited<ReturnType<typeof window.desktopApi.galleryList>>['items']) {
  return items
    .filter((item) => item.materialKind !== 'VIDEO' && item.asset.mimeType.startsWith('image/'))
    .map((item) => ({ asset: item.asset }));
}

function collectionIdentity(collection: MaterialImagePickerCollection) {
  if (collection.kind === 'all') return 'all';
  if (collection.kind === 'album') return JSON.stringify(['album', collection.albumId]);
  return JSON.stringify([
    'dictionary',
    collection.domainId ?? null,
    collection.typeId ?? null,
    collection.termId ?? null,
  ]);
}

function collectionDepth(collection: MaterialImagePickerCollection) {
  if (collection.kind !== 'dictionary') return 0;
  return Number(Boolean(collection.domainId)) + Number(Boolean(collection.typeId)) + Number(Boolean(collection.termId));
}

export function useMaterialImagePickerMaterials({
  active,
  libraryKey,
  dataRevision,
  collection,
  diagnostics,
}: {
  active: boolean;
  libraryKey: string;
  dataRevision: number;
  collection: MaterialImagePickerCollection;
  diagnostics?: MaterialImagePickerDiagnosticSink;
}) {
  const { locale } = useI18n();
  const collectionKind = collection.kind;
  const albumId = collection.kind === 'album' ? collection.albumId : null;
  const domainId = collection.kind === 'dictionary' ? collection.domainId : undefined;
  const typeId = collection.kind === 'dictionary' ? collection.typeId : undefined;
  const termId = collection.kind === 'dictionary' ? collection.termId : undefined;
  const queryCollection = useMemo<MaterialImagePickerCollection>(() => {
    if (collectionKind === 'album' && albumId) return { kind: 'album', albumId };
    if (collectionKind === 'dictionary') {
      return {
        kind: 'dictionary',
        scope: 'ALL',
        ...(domainId ? { domainId } : {}),
        ...(typeId ? { typeId } : {}),
        ...(termId ? { termId } : {}),
      };
    }
    return { kind: 'all' };
  }, [albumId, collectionKind, domainId, termId, typeId]);
  const queryIdentity = JSON.stringify([libraryKey, locale, collectionIdentity(queryCollection)]);
  const requestKey = JSON.stringify([queryIdentity, dataRevision]);
  const requestIdRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const loadedRequestKeyRef = useRef<string | null>(null);
  const [state, setState] = useState<MaterialImagePickerMaterialState>(() => ({
    ...initialMaterialState,
    identity: queryIdentity,
    loading: active,
  }));

  useEffect(() => {
    if (!active) return;
    if (loadedRequestKeyRef.current === requestKey) {
      diagnostics?.('materials.request.reused', {
        collectionDepth: collectionDepth(queryCollection),
        collectionKind: queryCollection.kind,
      });
      setState((current) => {
        if (current.identity !== queryIdentity) return current;
        if (
          current.requestKey === requestKey &&
          !current.stale &&
          !current.loading &&
          !current.loadingMore &&
          !current.failed
        ) {
          return current;
        }
        return { ...current, requestKey, stale: false, loading: false, loadingMore: false, failed: false };
      });
      return;
    }
    const requestId = ++requestIdRef.current;
    const startedAt = diagnostics ? performance.now() : 0;
    let settled = false;
    diagnostics?.('materials.request.started', {
      collectionDepth: collectionDepth(queryCollection),
      collectionKind: queryCollection.kind,
      requestId,
    });
    setState((current) => ({
      ...current,
      requestKey,
      stale: current.identity !== queryIdentity,
      loading: true,
      loadingMore: false,
      failed: false,
    }));
    void window.desktopApi
      .galleryList(listInput(queryCollection, locale, null))
      .then((page) => {
        if (requestIdRef.current !== requestId) return;
        settled = true;
        const images = imageItems(page.items);
        diagnostics?.('materials.request.succeeded', {
          durationMs: performance.now() - startedAt,
          imageCount: images.length,
          itemCount: page.items.length,
          requestId,
        });
        loadedRequestKeyRef.current = requestKey;
        setState((current) =>
          current.requestKey === requestKey
            ? {
                images,
                total: page.total,
                nextCursor: page.nextCursor,
                identity: queryIdentity,
                requestKey,
                stale: false,
                loaded: true,
                loading: false,
                loadingMore: false,
                failed: false,
              }
            : current,
        );
      })
      .catch((error: unknown) => {
        if (requestIdRef.current === requestId) {
          settled = true;
          diagnostics?.('materials.request.failed', {
            durationMs: performance.now() - startedAt,
            errorName: error instanceof Error ? error.name : 'unknown',
            requestId,
          });
          setState((current) =>
            current.requestKey === requestKey
              ? {
                  ...current,
                  stale: current.identity !== queryIdentity,
                  loaded: true,
                  loading: false,
                  loadingMore: false,
                  failed: true,
                }
              : current,
          );
        }
      });
    return () => {
      if (requestIdRef.current === requestId) {
        requestIdRef.current += 1;
        if (!settled) {
          diagnostics?.('materials.request.cancelled', {
            durationMs: performance.now() - startedAt,
            requestId,
          });
        }
      }
    };
  }, [active, diagnostics, locale, queryCollection, queryIdentity, requestKey]);

  const loadMore = useCallback(async () => {
    if (!active || state.identity !== queryIdentity || !state.nextCursor || state.loading || loadingMoreRef.current) {
      return;
    }
    const requestId = requestIdRef.current;
    const startedAt = diagnostics ? performance.now() : 0;
    loadingMoreRef.current = true;
    diagnostics?.('materials.load-more.started', { requestId });
    setState((current) => ({ ...current, loadingMore: true, failed: false }));
    try {
      const page = await window.desktopApi.galleryList(
        listInput(queryCollection, locale, state.nextCursor, state.total),
      );
      if (requestIdRef.current !== requestId) return;
      diagnostics?.('materials.load-more.succeeded', {
        durationMs: performance.now() - startedAt,
        itemCount: page.items.length,
        requestId,
      });
      setState((current) => {
        if (current.identity !== queryIdentity) return current;
        const seen = new Set(current.images.map(({ asset }) => asset.id));
        const nextImages = imageItems(page.items).filter(({ asset }) => !seen.has(asset.id));
        return {
          ...current,
          images: [...current.images, ...nextImages],
          nextCursor: page.nextCursor,
          loadingMore: false,
        };
      });
    } catch (error: unknown) {
      if (requestIdRef.current === requestId) {
        diagnostics?.('materials.load-more.failed', {
          durationMs: performance.now() - startedAt,
          errorName: error instanceof Error ? error.name : 'unknown',
          requestId,
        });
        setState((current) => ({ ...current, loadingMore: false, failed: true }));
      }
    } finally {
      loadingMoreRef.current = false;
    }
  }, [
    active,
    diagnostics,
    locale,
    queryCollection,
    queryIdentity,
    state.identity,
    state.loading,
    state.nextCursor,
    state.total,
  ]);

  const waitingForEffect = active && state.requestKey !== requestKey;
  const stale = state.identity !== queryIdentity;
  return {
    ...state,
    stale,
    failed: waitingForEffect ? false : state.failed,
    loading: state.loading || waitingForEffect,
    loadMore,
  };
}

export function useMaterialImagePickerAlbums({
  active,
  libraryKey,
  dataRevision,
  diagnostics,
}: {
  active: boolean;
  libraryKey: string;
  dataRevision: number;
  diagnostics?: MaterialImagePickerDiagnosticSink;
}) {
  const { locale } = useI18n();
  const queryIdentity = JSON.stringify([libraryKey, locale]);
  const requestKey = JSON.stringify([queryIdentity, dataRevision]);
  const loadedRequestKeyRef = useRef<string | null>(null);
  const [state, setState] = useState<MaterialImagePickerAlbumState>(() => ({
    ...initialAlbumState,
    identity: queryIdentity,
  }));

  useEffect(() => {
    if (!active) return;
    if (loadedRequestKeyRef.current === requestKey) {
      diagnostics?.('albums.request.reused');
      setState((current) => {
        if (current.identity !== queryIdentity) return current;
        if (current.requestKey === requestKey && !current.stale && !current.loading && !current.failed) return current;
        return { ...current, requestKey, stale: false, loading: false, failed: false };
      });
      return;
    }
    let cancelled = false;
    let settled = false;
    const startedAt = diagnostics ? performance.now() : 0;
    diagnostics?.('albums.request.started');
    setState((current) => ({
      ...current,
      requestKey,
      stale: current.identity !== queryIdentity,
      loading: true,
      failed: false,
    }));
    void window.desktopApi
      .materialAlbumsList({ locale })
      .then((albums) => {
        if (!cancelled) {
          settled = true;
          diagnostics?.('albums.request.succeeded', {
            albumCount: albums.length,
            durationMs: performance.now() - startedAt,
          });
          loadedRequestKeyRef.current = requestKey;
          setState((current) =>
            current.requestKey === requestKey
              ? {
                  albums,
                  identity: queryIdentity,
                  requestKey,
                  stale: false,
                  loaded: true,
                  loading: false,
                  failed: false,
                }
              : current,
          );
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          settled = true;
          diagnostics?.('albums.request.failed', {
            durationMs: performance.now() - startedAt,
            errorName: error instanceof Error ? error.name : 'unknown',
          });
          setState((current) =>
            current.requestKey === requestKey
              ? {
                  ...current,
                  stale: current.identity !== queryIdentity,
                  loaded: true,
                  loading: false,
                  failed: true,
                }
              : current,
          );
        }
      });
    return () => {
      cancelled = true;
      if (!settled) {
        diagnostics?.('albums.request.cancelled', { durationMs: performance.now() - startedAt });
      }
    };
  }, [active, diagnostics, locale, queryIdentity, requestKey]);

  const waitingForEffect = active && state.requestKey !== requestKey;
  return {
    ...state,
    stale: state.identity !== queryIdentity,
    failed: waitingForEffect ? false : state.failed,
    loading: state.loading || waitingForEffect,
  };
}
