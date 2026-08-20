import type { AssetDto, FacetDefinitionDto, TermListItem } from '@/shared/contracts';
import { MaterialImagePickerDialog } from '@/renderer/components/gallery/MaterialImagePickerDialog';
import {
  beginTransitionPickerDiagnosticSession,
  transitionPickerDiagnosticSink,
} from '@/renderer/features/extensions/transitionPickerDiagnostics';
import type {
  TransitionShowcaseCollection,
  TransitionShowcaseStoredImage,
} from '@/renderer/features/extensions/transitionShowcasePreferences';
import { useI18n } from '@/renderer/i18n/useI18n';

const MAX_SELECTED_PREVIEWS = 24;

function storedTransitionImage(asset: AssetDto): TransitionShowcaseStoredImage {
  return { id: asset.id, mediaUrl: asset.mediaUrl, width: asset.width, height: asset.height };
}

interface TransitionImagePickerDialogProps {
  open: boolean;
  libraryKey: string;
  dataRevision: number;
  terms: readonly TermListItem[];
  facets: readonly FacetDefinitionDto[];
  collection: TransitionShowcaseCollection;
  selectedImages: readonly TransitionShowcaseStoredImage[];
  onOpenChange(open: boolean): void;
  onCollectionChange(collection: TransitionShowcaseCollection): void;
  onApply(images: TransitionShowcaseStoredImage[]): void;
}

export function TransitionImagePickerDialog({
  open,
  libraryKey,
  dataRevision,
  terms,
  facets,
  collection,
  selectedImages,
  onOpenChange,
  onCollectionChange,
  onApply,
}: TransitionImagePickerDialogProps) {
  const { messages } = useI18n();
  const labels = messages.extensions.transitionShowcase;
  return (
    <MaterialImagePickerDialog
      open={open}
      dialogName="transition-image-picker"
      libraryKey={libraryKey}
      dataRevision={dataRevision}
      terms={terms}
      facets={facets}
      collection={collection}
      selectedImages={selectedImages}
      labels={{
        title: labels.chooseImagesTitle,
        choose: labels.chooseImages,
        apply: labels.useSelectedImages,
        noImages: labels.noSelectableImages,
        selected: labels.selectedImages,
        selectedOrder: labels.selectedOrder,
        dragToReorder: labels.dragToReorder,
        deselectAll: labels.deselectAllImages,
        deselectImage: labels.deselectImage,
        albumsLoadFailed: labels.albumsLoadFailed,
        loadingMaterials: labels.loadingMaterials,
        materialsLoadFailed: labels.materialsLoadFailed,
      }}
      maxSelected={MAX_SELECTED_PREVIEWS}
      diagnostics={transitionPickerDiagnosticSink}
      beginDiagnostics={beginTransitionPickerDiagnosticSession}
      createImage={storedTransitionImage}
      onOpenChange={onOpenChange}
      onCollectionChange={onCollectionChange}
      onApply={onApply}
    />
  );
}
