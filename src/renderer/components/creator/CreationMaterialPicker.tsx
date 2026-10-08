import { useEffect, useRef, useState } from 'react';
import { Paperclip } from 'lucide-react';
import type {
  AssetDto,
  CreationVideoAttachmentDto,
  FacetDefinitionDto,
  GalleryItemDto,
  TermListItem,
} from '@/shared/contracts';
import { ImageIcon } from '@/renderer/icons';
import { MaterialImagePickerDialog } from '@/renderer/components/gallery/MaterialImagePickerDialog';
import type { MaterialImagePickerCollection } from '@/renderer/components/gallery/materialImagePicker';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { intakeMediaAccept } from '@/renderer/features/intake/intakeImageFormats';
import { isVideoAsset } from '@/renderer/components/media/AssetMedia';

const MAX_CREATION_REFERENCES = 8;

type CreationMaterial = AssetDto & { videoAttachment?: CreationVideoAttachmentDto };

interface Props {
  libraryKey: string;
  dataRevision: number;
  terms: readonly TermListItem[];
  facets: readonly FacetDefinitionDto[];
  selectedAssets: readonly AssetDto[];
  selectedVideos?: readonly CreationVideoAttachmentDto[];
  disabled?: boolean;
  toolbar?: boolean;
  onBeforeOpen?(): void | Promise<void>;
  onApply(assets: AssetDto[]): void;
  onImport(): void | Promise<void>;
  onApplyVideos?(videos: CreationVideoAttachmentDto[]): void;
  onImportFiles?(files: File[]): void | Promise<void>;
}

export function CreationMaterialPicker({
  libraryKey,
  dataRevision,
  terms,
  facets,
  selectedAssets,
  selectedVideos = [],
  disabled = false,
  toolbar = false,
  onBeforeOpen,
  onApply,
  onImport,
  onApplyVideos,
  onImportFiles,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.materialPicker;
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [collection, setCollection] = useState<MaterialImagePickerCollection>({ kind: 'all' });
  const includeVideos = Boolean(onApplyVideos);
  const selectedMaterials: CreationMaterial[] = [
    ...selectedAssets,
    ...selectedVideos.map((videoAttachment) => ({ ...videoAttachment.asset, videoAttachment })),
  ];

  function creationReference(asset: AssetDto, item: GalleryItemDto): CreationMaterial {
    if (!isVideoAsset(asset)) return asset;
    return {
      ...asset,
      videoAttachment: {
        materialId: item.materialId!,
        name:
          item.metadata?.displayName ||
          item.metadata?.originalName ||
          messages.contentManagement.subtypes.videoMaterial,
        durationMs: item.durationMs!,
        asset,
      },
    };
  }

  function selectionDisabledReason(item: GalleryItemDto, selected: readonly CreationMaterial[]) {
    const video = isVideoAsset(item.asset);
    if (video && (!item.materialId || !Number.isSafeInteger(item.durationMs) || item.durationMs! <= 0))
      return messages.videoDocuments.sourceUnavailable;
    if (selected.filter((asset) => isVideoAsset(asset) === video).length >= MAX_CREATION_REFERENCES)
      return video ? labels.videoLimit : labels.imageLimit;
  }

  useEffect(() => {
    if (open) void onBeforeOpen?.();
  }, [dataRevision, onBeforeOpen, open]);

  return (
    <>
      <Button
        data-action="creation-material-picker"
        type="button"
        variant={toolbar ? 'ghost' : 'outline'}
        size={toolbar ? 'sm' : 'icon'}
        className={toolbar ? 'h-8 gap-1.5 px-2' : 'rounded-full'}
        disabled={disabled}
        title={toolbar ? messages.creator.starter.materials : labels.add}
        aria-label={toolbar ? messages.creator.starter.materials : labels.add}
        onClick={() => setOpen(true)}
      >
        {toolbar ? <Paperclip className="size-3.5" aria-hidden /> : <ImageIcon className="size-4" />}
        {toolbar && messages.creator.starter.materials}
        {toolbar && selectedMaterials.length > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">{selectedMaterials.length}</span>
        )}
      </Button>
      {onImportFiles && (
        <input
          ref={fileInput}
          type="file"
          accept={intakeMediaAccept}
          multiple
          className="hidden"
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            if (files.length) void onImportFiles(files);
          }}
        />
      )}
      <MaterialImagePickerDialog
        open={open}
        dialogName="creation-image-picker"
        libraryKey={libraryKey}
        dataRevision={dataRevision}
        terms={terms}
        facets={facets}
        collection={collection}
        selectedImages={selectedMaterials}
        labels={{
          title: labels.title,
          choose: labels.choose,
          apply: labels.apply,
          noImages: labels.empty,
          selected: labels.selectedImages,
          selectedOrder: labels.selectedOrder,
          dragToReorder: labels.dragToReorder,
          deselectAll: labels.deselectAll,
          deselectImage: labels.deselectImage,
          albumsLoadFailed: labels.albumsLoadFailed,
          loadingMaterials: labels.loadingMaterials,
          materialsLoadFailed: labels.materialsLoadFailed,
        }}
        maxSelected={MAX_CREATION_REFERENCES * (includeVideos ? 2 : 1)}
        includeVideos={includeVideos}
        selectionDisabledReason={selectionDisabledReason}
        secondaryAction={{
          label: includeVideos ? labels.importing : labels.importImages,
          onSelect: () => (onImportFiles ? fileInput.current?.click() : void onImport()),
        }}
        createImage={creationReference}
        onOpenChange={setOpen}
        onCollectionChange={setCollection}
        onApply={(materials) => {
          onApply(materials.filter((asset) => !isVideoAsset(asset)));
          onApplyVideos?.(materials.flatMap((asset) => (asset.videoAttachment ? [asset.videoAttachment] : [])));
        }}
      />
    </>
  );
}
