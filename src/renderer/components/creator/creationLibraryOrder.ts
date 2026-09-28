export interface CreationLibraryOrderEntry {
  key: string;
  pinned: boolean;
  activityAt: string;
  createdAt: string;
}

/** Directory and outline siblings follow recent changes, independent of stored membership positions. */
export function compareCreationLibraryOrder(left: CreationLibraryOrderEntry, right: CreationLibraryOrderEntry) {
  return (
    Number(right.pinned) - Number(left.pinned) ||
    right.activityAt.localeCompare(left.activityAt) ||
    right.createdAt.localeCompare(left.createdAt) ||
    left.key.localeCompare(right.key)
  );
}
