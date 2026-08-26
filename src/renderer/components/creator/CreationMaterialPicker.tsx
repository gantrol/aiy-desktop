import { useEffect, useState } from 'react';
import type { AssetDto, FacetDefinitionDto, TermListItem } from '@/shared/contracts';
import { ImageIcon } from '@/renderer/icons';
import { MaterialImagePickerDialog } from '@/renderer/components/gallery/MaterialImagePickerDialog';
import type { MaterialImagePickerCollection } from '@/renderer/components/gallery/materialImagePicker';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

const MAX_CREATION_REFERENCES = 8;

function creationReference(asset: AssetDto) {
  return asset;
}

interface Props {
  libraryKey: string;
  dataRevision: number;
  terms: readonly TermListItem[];
  facets: readonly FacetDefinitionDto[];
  selectedAssets: readonly AssetDto[];
  disabled?: boolean;
  onBeforeOpen?(): void | Promise<void>;
  onApply(assets: AssetDto[]): void;
  onImport(): void | Promise<void>;
}

export function CreationMaterialPicker({
  libraryKey,
  dataRevision,
  terms,
  facets,
  selectedAssets,
  disabled = false,
  onBeforeOpen,
  onApply,
  onImport,
}: Props) {
  const labels = useI18n().messages.creator.materialPicker;
  const [open, setOpen] = useState(false);
  const [collection, setCollection] = useState<MaterialImagePickerCollection>({ kind: 'all' });

  useEffect(() => {
    if (open) void onBeforeOpen?.();
  }, [dataRevision, onBeforeOpen, open]);

  return (
    <>
      <Button
        data-action="creation-material-picker"
        type="button"
        variant="outline"
        size="icon"
        className="rounded-full"
        disabled={disabled}
        title={labels.add}
        aria-label={labels.add}
        onClick={() => setOpen(true)}
      >
        <ImageIcon className="size-4" />
      </Button>
      <MaterialImagePickerDialog
        open={open}
        dialogName="creation-image-picker"
        libraryKey={libraryKey}
        dataRevision={dataRevision}
        terms={terms}
        facets={facets}
        collection={collection}
        selectedImages={selectedAssets}
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
        maxSelected={MAX_CREATION_REFERENCES}
        secondaryAction={{ label: labels.importing, onSelect: () => void onImport() }}
        createImage={creationReference}
        onOpenChange={setOpen}
        onCollectionChange={setCollection}
        onApply={onApply}
      />
    </>
  );
}
