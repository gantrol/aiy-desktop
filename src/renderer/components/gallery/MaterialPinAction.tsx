import type { MaterialLibraryItem } from '@/renderer/components/gallery/materialLibraryTypes';
import { PinContentButton } from '@/renderer/features/desktop-petals/PinContentAction';
import type { PinSource } from '@/shared/contracts/petal-board';

export function materialPinSource(item: MaterialLibraryItem): PinSource {
  if (item.kind === 'TEXT') return { kind: 'MATERIAL', id: item.text.id };
  return item.image.materialId
    ? { kind: 'MATERIAL', id: item.image.materialId }
    : { kind: 'IMAGE', id: item.image.asset.id };
}

export function MaterialPinAction({
  item,
  disabled,
  notify,
}: {
  item: MaterialLibraryItem;
  disabled?: boolean;
  notify(message: string): void;
}) {
  return <PinContentButton source={materialPinSource(item)} disabled={disabled} notify={notify} />;
}
