export type MaterialImagePickerCollection =
  | { kind: 'all' }
  | { kind: 'album'; albumId: string }
  | {
      kind: 'dictionary';
      scope: 'ALL';
      domainId?: string;
      typeId?: string;
      termId?: string;
    };

export interface MaterialImagePickerImage {
  id: string;
  mediaUrl: string;
  width: number;
  height: number;
}

export type MaterialImagePickerDiagnosticValue = string | number | boolean | null;
export type MaterialImagePickerDiagnosticDetails = Readonly<
  Record<string, MaterialImagePickerDiagnosticValue | undefined>
>;
export type MaterialImagePickerDiagnosticSink = (name: string, details?: MaterialImagePickerDiagnosticDetails) => void;

export function materialImagePickerCollectionDepth(collection: MaterialImagePickerCollection) {
  if (collection.kind !== 'dictionary') return 0;
  return Number(Boolean(collection.domainId)) + Number(Boolean(collection.typeId)) + Number(Boolean(collection.termId));
}

export function reorderMaterialImagePickerImages<T extends MaterialImagePickerImage>(
  images: readonly T[],
  sourceId: string,
  targetId: string,
  afterTarget: boolean,
) {
  const sourceIndex = images.findIndex((image) => image.id === sourceId);
  if (sourceIndex < 0 || sourceId === targetId) return [...images];
  const next = [...images];
  const [source] = next.splice(sourceIndex, 1);
  if (!source) return next;
  const targetIndex = next.findIndex((image) => image.id === targetId);
  if (targetIndex < 0) return [...next, source];
  next.splice(targetIndex + Number(afterTarget), 0, source);
  return next;
}
