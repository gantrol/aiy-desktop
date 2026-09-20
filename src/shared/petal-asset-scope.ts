/** The main process derives this set from the window's source, never from renderer paths. */
export function noteAssetIds(note: {
  references: readonly { assetId: string }[];
  importedImages?: readonly { id: string }[];
}): ReadonlySet<string> {
  return new Set([
    ...note.references.map((item) => item.assetId),
    ...(note.importedImages ?? []).map((item) => item.id),
  ]);
}

export function requirePetalAsset(assetId: string, allowed: ReadonlySet<string>) {
  if (!allowed.has(assetId)) throw new Error('Asset is not available to this content window');
}
