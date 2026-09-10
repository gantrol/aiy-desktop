import { useCallback, useEffect, useRef, useState } from 'react';
import { registerWorkspaceDrain } from '@/renderer/components/workspace/workspace-drain';
import type { AssetDto } from '@/shared/contracts';
import type { GifDocumentPurpose, GifMotionDraft } from '@/shared/contracts/gif-motion-draft';
import {
  gifErrorCode,
  gifManifestSchema,
  newGifManifest,
  type GifDocument,
  type GifDocumentDetail,
  type GifErrorCode,
  type GifManifest,
} from '@/shared/contracts/gif-making';

const contentKey = (document: GifDocument) => JSON.stringify([document.title, document.manifest, document.motionDraft]);
function initialManifest(asset: AssetDto | undefined, assets: AssetDto[], purpose: GifDocumentPurpose) {
  const images = assets.filter((item) => ['image/png', 'image/jpeg', 'image/webp'].includes(item.mimeType));
  const first = asset && ['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType) ? asset : images[0];
  const manifest = newGifManifest(first);
  if (purpose === 'GIF' && images.length > 1)
    manifest.frames = images.map((item) => ({
      id: crypto.randomUUID(),
      assetId: item.id,
      durationMs: 100,
      sourceRect: null,
    }));
  return manifest;
}
export function useGifProject(
  seriesId: string | null,
  initialAsset: AssetDto | undefined,
  initialAssets: AssetDto[],
  purpose: GifDocumentPurpose = 'GIF',
  initialDocument?: GifDocumentDetail,
) {
  const seed = useRef({ seriesId, initialAsset, purpose });
  const [document, setDocument] = useState<GifDocument>(
    () =>
      initialDocument?.document ?? {
        purpose,
        motionDraft: null,
        id: crypto.randomUUID(),
        seriesId,
        revision: 0,
        title: '',
        updatedAt: '',
        manifest: initialManifest(initialAsset, initialAssets, purpose),
      },
  );
  const current = useRef(document);
  const revisions = useRef(new Map(initialDocument ? [[document.id, document.revision]] : []));
  const saved = useRef(new Map(initialDocument ? [[document.id, contentKey(document)]] : []));
  // Operation messages can be cleared; a revision conflict requires a new base or a copy.
  const conflicts = useRef(new Set<string>());
  const replacementRevision = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const loadRequest = useRef(0);
  const mounted = useRef(true);
  const edited = useRef(false);
  const [assets, setAssets] = useState(
    () => new Map([...initialAssets, ...(initialDocument?.assets ?? [])].map((asset) => [asset.id, asset])),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setLastError] = useState<GifErrorCode | null>(null);
  const setError = useCallback((value: GifErrorCode | null) => {
    if (value === 'GIF_CONFLICT') conflicts.current.add(current.current.id);
    setLastError(value);
  }, []);
  const capture = useCallback(() => current.current, []);
  const addAssets = useCallback(
    (items: AssetDto[]) =>
      setAssets((previous) => new Map([...previous, ...items.map((asset) => [asset.id, asset] as const)])),
    [],
  );
  const save = useCallback((): Promise<GifDocument> => {
    const snapshot = current.current;
    const replacement = replacementRevision.current;
    const operation = queue.current
      .catch(() => undefined)
      .then(async () => {
        if (replacement !== replacementRevision.current) throw new Error('GIF_CANCELLED');
        if (conflicts.current.has(snapshot.id)) throw new Error('GIF_CONFLICT');
        if (saved.current.get(snapshot.id) === contentKey(snapshot))
          return { ...snapshot, revision: revisions.current.get(snapshot.id)! };
        if (mounted.current) setSaving(true);
        try {
          const parsed = gifManifestSchema.safeParse(snapshot.manifest);
          if (!parsed.success) throw new Error('GIF_INVALID');
          const result = await window.desktopApi.gifSave({
            purpose: snapshot.purpose,
            motionDraft: snapshot.motionDraft,
            id: snapshot.id,
            seriesId: snapshot.seriesId,
            title: snapshot.title,
            expectedRevision: revisions.current.get(snapshot.id) ?? snapshot.revision,
            manifest: parsed.data,
          });
          if (replacement !== replacementRevision.current) throw new Error('GIF_CANCELLED');
          revisions.current.set(result.id, result.revision);
          saved.current.set(result.id, contentKey(snapshot));
          if (current.current.id === result.id) {
            current.current = { ...current.current, revision: result.revision, updatedAt: result.updatedAt };
            if (mounted.current) setDocument(current.current);
          }
          if (mounted.current && current.current.id === result.id) setError(null);
          return result;
        } catch (reason) {
          if (replacement !== replacementRevision.current) throw new Error('GIF_CANCELLED');
          const code = gifErrorCode(reason);
          if (code === 'GIF_CONFLICT') conflicts.current.add(snapshot.id);
          if (mounted.current && current.current.id === snapshot.id) setError(code);
          throw reason;
        } finally {
          if (mounted.current) setSaving(false);
        }
      });
    queue.current = operation;
    return operation;
  }, [setError]);
  useEffect(
    () =>
      registerWorkspaceDrain(async () => {
        if (edited.current) await save();
      }),
    [save],
  );
  const accept = useCallback(
    (detail: GifDocumentDetail, expected?: GifDocument) => {
      if (
        expected &&
        (current.current.id !== expected.id ||
          detail.document.id !== expected.id ||
          current.current.revision > detail.document.revision ||
          contentKey(current.current) !== contentKey(expected))
      ) {
        setError('GIF_CONFLICT');
        throw new Error('GIF_CONFLICT');
      }
      const { id } = detail.document;
      replacementRevision.current += 1;
      conflicts.current.delete(id);
      revisions.current.set(id, detail.document.revision);
      saved.current.set(id, contentKey(detail.document));
      current.current = detail.document;
      edited.current = false;
      setDocument(detail.document);
      addAssets(detail.assets);
      setError(null);
    },
    [addAssets, setError],
  );
  const load = useCallback(
    async (id: string) => {
      const request = ++loadRequest.current;
      setLoading(true);
      try {
        if (edited.current) await save();
        const detail = await window.desktopApi.gifLoad(id);
        if (!mounted.current || request !== loadRequest.current) return;
        accept(detail);
      } catch (reason) {
        if (mounted.current && request === loadRequest.current) setError(gifErrorCode(reason));
        throw reason;
      } finally {
        if (mounted.current && request === loadRequest.current) setLoading(false);
      }
    },
    [accept, save, setError],
  );
  useEffect(() => {
    mounted.current = true;
    const conflictedDocuments = conflicts.current;
    let cancelled = false;
    const initialization = loadRequest.current;
    void (async () => {
      try {
        const existing =
          !initialDocument &&
          seed.current.initialAsset &&
          (seed.current.purpose === 'MOTION' || seed.current.initialAsset.mimeType === 'image/gif')
            ? await window.desktopApi.gifFindForAsset(
                seed.current.initialAsset.id,
                seed.current.purpose,
                seed.current.seriesId,
              )
            : null;
        if (cancelled) return;
        if (loadRequest.current !== initialization) return;
        if (existing) await load(existing);
        else if (!initialDocument && seed.current.initialAsset?.mimeType === 'image/gif')
          setError('GIF_ANIMATED_SOURCE');
      } catch (reason) {
        if (!cancelled) setError(gifErrorCode(reason));
      } finally {
        if (!cancelled && loadRequest.current === initialization) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      mounted.current = false;
      if (edited.current && !conflictedDocuments.has(current.current.id)) void save().catch(() => undefined);
    };
  }, [load, save, initialDocument, setError]);
  const change = useCallback(
    (operation: (manifest: GifManifest) => GifManifest) => {
      const next = { ...current.current, manifest: operation(current.current.manifest) };
      current.current = next;
      edited.current = true;
      setDocument(next);
      setError(null);
    },
    [setError],
  );
  const title = (value: string) => {
    current.current = { ...current.current, title: value };
    edited.current = true;
    setDocument(current.current);
  };
  const updateDraft = useCallback((motionDraft: GifMotionDraft) => {
    if (JSON.stringify(current.current.motionDraft) === JSON.stringify(motionDraft)) return;
    current.current = { ...current.current, motionDraft };
    edited.current = true;
    setDocument(current.current);
  }, []);
  useEffect(() => {
    if (!edited.current || loading || conflicts.current.has(document.id)) return;
    const timer = setTimeout(() => {
      void save().catch(() => undefined);
    }, 800);
    return () => clearTimeout(timer);
  }, [document.id, document.manifest, document.title, document.motionDraft, loading, error, save]);
  const create = async (copy = false) => {
    if (!copy && edited.current) await save();
    const next: GifDocument = {
      purpose,
      motionDraft: copy ? current.current.motionDraft : null,
      id: crypto.randomUUID(),
      seriesId: current.current.seriesId,
      title: copy ? current.current.title : '',
      revision: 0,
      updatedAt: '',
      manifest: copy ? current.current.manifest : newGifManifest(),
    };
    current.current = next;
    edited.current = copy;
    replacementRevision.current += 1;
    setDocument(next);
    setError(null);
    if (copy) await save();
  };
  return {
    document,
    assets,
    loading,
    saving,
    error: conflicts.current.has(document.id) ? ('GIF_CONFLICT' as const) : error,
    conflicted: conflicts.current.has(document.id),
    setError,
    change,
    title,
    save,
    capture,
    load,
    accept,
    updateDraft,
    create,
    addAssets,
    dirty: saved.current.get(document.id) !== contentKey(document),
  };
}
