import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssetDto, TermListItem } from '@/shared/contracts';
import type { GifDocumentPurpose } from '@/shared/contracts/gif-motion-draft';
import {
  GIF_MAX_FRAMES,
  gifErrorCode,
  gifPlaybackFrames,
  newGifManifest,
  type GifExportResult,
  type GifProgress,
  type GifManifest,
  type GifDocumentDetail,
} from '@/shared/contracts/gif-making';
import type { MaterialImagePickerCollection } from '@/renderer/components/gallery/materialImagePicker';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useGifProject } from '@/renderer/features/gif-making/useGifProject';
export const staticImage = (asset: AssetDto) => ['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType);
const firstImageCanvas = (value: GifManifest, asset?: AssetDto) => {
  if (value.frames.length || !asset || value.width !== 512 || value.height !== 512) return value;
  const { width, height } = newGifManifest(asset);
  return { ...value, width, height };
};
export interface GifMakerProps {
  initialDocument?: GifDocumentDetail;
  purpose?: GifDocumentPurpose;
  seriesId: string | null;
  initialAsset?: AssetDto;
  initialAssets: AssetDto[];
  spaceId: string;
  terms: TermListItem[];
  onClose(): void;
  onExported(asset: AssetDto): Promise<void>;
}

export function useGifMaker({
  purpose = 'GIF',
  seriesId,
  initialAsset,
  initialAssets,
  initialDocument,
  spaceId,
  terms,
  onClose,
  onExported,
}: GifMakerProps) {
  const { messages } = useI18n();
  const labels = messages.creator.gifMaker;
  const pickerLabels = messages.creator.materialPicker;
  const project = useGifProject(seriesId, initialAsset, initialAssets, purpose, initialDocument);
  const { setError } = project;
  const { document, assets, change: changeManifest } = project;
  const { manifest } = document;
  const [selectedId, setSelectedId] = useState<string>();
  const selected = manifest.frames.find((frame) => frame.id === selectedId) ?? manifest.frames[0];
  const selectedIndex = selected ? manifest.frames.indexOf(selected) : -1;
  const selectedAsset = selected ? assets.get(selected.assetId) : undefined;
  const [playing, setPlaying] = useState(false),
    [playIndex, setPlayIndex] = useState(0);
  const [picker, setPicker] = useState<'frames' | 'background' | null>(null);
  const [collection, setCollection] = useState<MaterialImagePickerCollection>({ kind: 'all' });
  const [sheet, setSheet] = useState(false),
    [settings, setSettings] = useState(false);
  const [importing, setImporting] = useState(false),
    [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<GifProgress | null>(null);
  const [result, setResult] = useState<GifExportResult | null>(initialDocument?.latestExport ?? null);
  const [showEncoded, setShowEncoded] = useState(false);
  const change = (operation: (manifest: GifManifest) => GifManifest) => {
    setShowEncoded(false);
    changeManifest(operation);
  };
  const fileInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const activeRun = useRef<string | null>(null);
  const alive = useRef(true);
  const importLock = useRef(false);
  const exportLock = useRef(false);
  const sequence = useMemo(() => gifPlaybackFrames(manifest), [manifest]);
  const busy = importing || project.loading;
  const fail = useCallback(() => setError('GIF_ASSET_UNAVAILABLE'), [setError]);
  useEffect(() => {
    alive.current = true;
    const unsubscribe = window.desktopApi.onGifProgress((value) => {
      if (value.runId === activeRun.current) setProgress(value);
    });
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!playing || !sequence.length) return;
    const frame = sequence[playIndex % sequence.length];
    const timer = setTimeout(() => {
      if (playIndex + 1 >= sequence.length && manifest.loop === 'ONCE') {
        setPlaying(false);
        setSelectedId(frame.id);
      } else setPlayIndex((index) => (index + 1) % sequence.length);
    }, frame.durationMs);
    return () => clearTimeout(timer);
  }, [playing, sequence, playIndex, manifest.loop]);
  const select = (id: string) => {
    setSelectedId(id);
    setPlaying(false);
    setShowEncoded(false);
  };
  const add = (items: AssetDto[], background = false) => {
    if (items.some((asset) => !staticImage(asset))) {
      project.setError('GIF_ANIMATED_SOURCE');
      return;
    }
    if (purpose === 'MOTION') {
      const source = items[0];
      if (!source) return;
      project.addAssets([source]);
      change(() => newGifManifest(source));
      return;
    }
    if (!background && manifest.frames.length + items.length > GIF_MAX_FRAMES) {
      project.setError('GIF_LIMIT');
      return;
    }
    project.addAssets(items);
    setShowEncoded(false);
    if (background) {
      change((value) => ({ ...value, backgroundAssetId: items[0]?.id ?? null }));
      setSettings(true);
    } else {
      const frames = items.map((asset) => ({
        id: crypto.randomUUID(),
        assetId: asset.id,
        durationMs: selected?.durationMs ?? 100,
        sourceRect: null,
      }));
      change((value) => ({ ...firstImageCanvas(value, items[0]), frames: [...value.frames, ...frames] }));
      if (frames[0]) select(frames[0].id);
    }
  };
  const importFiles = async (files: File[], background = false) => {
    if (importLock.current || !files.length) return;
    if (!background && files.length + manifest.frames.length > GIF_MAX_FRAMES) {
      project.setError('GIF_LIMIT');
      return;
    }
    importLock.current = true;
    setImporting(true);
    project.setError(null);
    try {
      for (const file of background || purpose === 'MOTION' ? files.slice(0, 1) : files) {
        if (!alive.current) break;
        if (!file.size || file.size > 25 * 1024 * 1024) throw new Error('GIF_LIMIT');
        const asset = await window.desktopApi.gifImport({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
        });
        if (!alive.current) break;
        project.addAssets([asset]);
        if (purpose === 'MOTION') {
          change(() => newGifManifest(asset));
          continue;
        }
        if (background) {
          change((value) => ({ ...value, backgroundAssetId: asset.id }));
          setSettings(true);
          setShowEncoded(false);
          continue;
        }
        const id = crypto.randomUUID();
        change((value) => ({
          ...firstImageCanvas(value, asset),
          frames: [...value.frames, { id, assetId: asset.id, durationMs: 100, sourceRect: null }],
        }));
        select(id);
      }
    } catch (reason) {
      if (alive.current) project.setError(gifErrorCode(reason));
    } finally {
      importLock.current = false;
      if (alive.current) setImporting(false);
    }
  };
  const move = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    change((value) => {
      const frames = [...value.frames];
      const source = frames.findIndex((frame) => frame.id === sourceId),
        target = frames.findIndex((frame) => frame.id === targetId);
      if (source < 0 || target < 0) return value;
      const [frame] = frames.splice(source, 1);
      frames.splice(target, 0, frame);
      return { ...value, frames };
    });
  };
  const close = async () => {
    if (busy || exporting) return;
    try {
      if (project.dirty && (manifest.frames.length || document.title)) await project.save();
      onClose();
    } catch {
      /* The project hook keeps the error and unsaved edits visible. */
    }
  };
  const exportGif = async () => {
    if (exportLock.current || busy || manifest.frames.length < 2) return;
    exportLock.current = true;
    setExporting(true);
    project.setError(null);
    setPlaying(false);
    try {
      const snapshot = await project.save();
      if (!alive.current) return;
      const runId = crypto.randomUUID();
      activeRun.current = runId;
      setProgress({ runId, stage: 'PREPARING', completed: 0, total: 1 });
      const output = await window.desktopApi.gifExport({ documentId: snapshot.id, revision: snapshot.revision, runId });
      if (!alive.current) return;
      setResult(output);
      setShowEncoded(true);
      await onExported(output.asset);
    } catch (reason) {
      if (alive.current) project.setError(gifErrorCode(reason));
    } finally {
      exportLock.current = false;
      activeRun.current = null;
      if (alive.current) {
        setExporting(false);
        setProgress(null);
      }
    }
  };
  const safe = (operation: () => Promise<unknown>) => {
    void operation().catch((reason) => project.setError(gifErrorCode(reason)));
  };

  return {
    labels,
    pickerLabels,
    project,
    document,
    assets,
    change,
    manifest,
    selectedId,
    setSelectedId,
    selected,
    selectedIndex,
    selectedAsset,
    playing,
    setPlaying,
    playIndex,
    setPlayIndex,
    picker,
    setPicker,
    collection,
    setCollection,
    sheet,
    setSheet,
    settings,
    setSettings,
    importing,
    exporting,
    progress,
    setProgress,
    result,
    setResult,
    showEncoded,
    setShowEncoded,
    fileInput,
    backgroundInput,
    activeRun,
    sequence,
    busy,
    fail,
    select,
    add,
    importFiles,
    move,
    close,
    exportGif,
    safe,
    initialAssets,
    spaceId,
    terms,
  };
}
export type GifMakerModel = ReturnType<typeof useGifMaker>;
