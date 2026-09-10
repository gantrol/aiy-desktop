import { useEffect, useRef } from 'react';
import type { AssetDto, FacetDefinitionDto } from '@/shared/contracts';
import { GIF_MAX_FRAMES, type GifManifest } from '@/shared/contracts/gif-making';
import { MaterialImagePickerDialog } from '@/renderer/components/gallery/MaterialImagePickerDialog';
import { GifSheetDialog } from '@/renderer/features/gif-making/GifSheetDialog';
import type { GifMakerModel } from '@/renderer/features/gif-making/useGifMaker';
import { useStableCallback } from '@/renderer/lib/useStableCallback';
const emptyAssets: AssetDto[] = [];
const emptyFacets: FacetDefinitionDto[] = [];
const asAsset = (asset: AssetDto) => asset;
export function GifMakerPickers({ model }: { model: GifMakerModel }) {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const canApply = useStableCallback((id: string, manifest: GifManifest) => {
    const current = model.project.capture();
    return mounted.current && !model.busy && !model.exporting && current.id === id && current.manifest === manifest;
  });
  const {
    labels,
    pickerLabels,
    assets,
    change,
    manifest,
    selected,
    selectedIndex,
    selectedAsset,
    picker,
    setPicker,
    collection,
    setCollection,
    sheet,
    setSheet,
    select,
    add,
    spaceId,
    terms,
  } = model;
  return (
    <>
      {picker && !model.busy && !model.exporting && (
        <MaterialImagePickerDialog
          open
          dialogName="gif-image-picker"
          libraryKey={spaceId}
          dataRevision={assets.size}
          terms={terms}
          facets={emptyFacets}
          collection={collection}
          selectedImages={emptyAssets}
          maxSelected={
            picker === 'background' || model.document.purpose === 'MOTION' ? 1 : GIF_MAX_FRAMES - manifest.frames.length
          }
          createImage={asAsset}
          onOpenChange={(open) => {
            if (!open) setPicker(null);
          }}
          onCollectionChange={setCollection}
          onApply={(items) => {
            if (!canApply(model.document.id, manifest)) return;
            add(items, picker === 'background');
            setPicker(null);
          }}
          labels={{
            title: picker === 'background' ? labels.background : labels.addImages,
            choose: pickerLabels.choose,
            apply: pickerLabels.apply,
            noImages: pickerLabels.empty,
            selected: pickerLabels.selectedImages,
            selectedOrder: pickerLabels.selectedOrder,
            dragToReorder: pickerLabels.dragToReorder,
            deselectAll: pickerLabels.deselectAll,
            deselectImage: pickerLabels.deselectImage,
            albumsLoadFailed: pickerLabels.albumsLoadFailed,
            loadingMaterials: pickerLabels.loadingMaterials,
            materialsLoadFailed: pickerLabels.materialsLoadFailed,
          }}
        />
      )}
      {sheet && !model.busy && !model.exporting && selected && selectedAsset && (
        <GifSheetDialog
          asset={selectedAsset}
          frame={selected}
          availableFrames={GIF_MAX_FRAMES - manifest.frames.length + 1}
          onClose={() => setSheet(false)}
          onApply={(frames) => {
            if (!canApply(model.document.id, manifest)) return;
            change((value) => ({
              ...value,
              width: frames[0].sourceRect!.width,
              height: frames[0].sourceRect!.height,
              frames: [...value.frames.slice(0, selectedIndex), ...frames, ...value.frames.slice(selectedIndex + 1)],
            }));
            select(frames[0].id);
            setSheet(false);
          }}
        />
      )}
    </>
  );
}
