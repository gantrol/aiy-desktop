import { patchAlbumMemberships } from '@/renderer/components/gallery/materialAlbumMembershipModel';
import type { MaterialAlbumMembershipApplyResult } from '@/shared/contracts/material-album-membership';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale, MaterialAlbumDto } from '@/shared/contracts';

const emptyAlbums: MaterialAlbumDto[] = [];

interface Options {
  active: boolean;
  libraryKey: string;
  dataRevision: number;
  locale: Locale;
  retryKey: number;
}

export function useMaterialAlbumDirectory({ active, libraryKey, dataRevision, locale, retryKey }: Options) {
  const key = JSON.stringify([libraryKey, dataRevision, locale, retryKey]);
  const requestRef = useRef<{ key: string; promise: Promise<MaterialAlbumDto[]>; failed: boolean } | null>(null);
  const [snapshot, setSnapshot] = useState({ key: '', libraryKey: '', albums: emptyAlbums });
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const libraryRef = useRef(libraryKey);
  libraryRef.current = libraryKey;
  const keyRef = useRef(key);
  keyRef.current = key;
  const [failure, setFailure] = useState({ key: '', message: '' });

  // Keep one revision-bound result, shared by navigation and the current overview request.
  const read = useCallback(
    (reload = false) => {
      if (!reload && requestRef.current?.key === key && !requestRef.current.failed) return requestRef.current.promise;
      const promise = window.desktopApi.materialAlbumsList({ locale });
      requestRef.current = { key, promise, failed: false };
      void promise.catch(() => {
        if (requestRef.current?.promise === promise) requestRef.current.failed = true;
      });
      return promise;
    },
    [key, locale],
  );

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setFailure({ key: '', message: '' });
    const promise = read();
    void promise
      .then((albums) => {
        if (cancelled || requestRef.current?.promise !== promise) return;
        setSnapshot((current) =>
          current.key === key && current.albums === albums ? current : { key, libraryKey, albums },
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled && requestRef.current?.promise === promise) {
          setFailure({ key, message: reason instanceof Error ? reason.message : String(reason) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active, key, libraryKey, read]);

  const reload = useCallback(async () => {
    const promise = read(true);
    const albums = await promise;
    if (requestRef.current?.promise === promise) {
      setFailure({ key: '', message: '' });
      setSnapshot({ key, libraryKey, albums });
    }
    return albums;
  }, [key, libraryKey, read]);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  const applyMembership = useCallback(
    (result: Extract<MaterialAlbumMembershipApplyResult, { status: 'APPLIED' }>) => {
      if (libraryRef.current !== libraryKey) return;
      const current = snapshotRef.current;
      const next = { ...current, albums: patchAlbumMemberships(current.albums, result) };
      snapshotRef.current = next;
      // Invalidate any read started before the mutation, without reloading the whole directory.
      requestRef.current = { key: next.key, promise: Promise.resolve(next.albums), failed: false };
      setSnapshot(next);
      if (next.key !== keyRef.current) {
        // A separate revision/locale change still needs its directory read. Do not
        // leave that consumer loading after invalidating its pre-mutation result.
        const requestedKey = keyRef.current;
        void reloadRef.current().catch((reason: unknown) => {
          if (keyRef.current === requestedKey) {
            setFailure({ key: requestedKey, message: reason instanceof Error ? reason.message : String(reason) });
          }
        });
      }
    },
    [libraryKey],
  );

  const loaded = snapshot.key === key;
  const error = failure.key === key ? failure.message : '';
  return {
    albums: snapshot.libraryKey === libraryKey ? snapshot.albums : emptyAlbums,
    loaded,
    loading: active && !loaded && !error,
    error,
    read,
    reload,
    applyMembership,
  };
}
