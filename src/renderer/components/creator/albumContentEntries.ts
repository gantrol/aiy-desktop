import type { AlbumDto, AlbumMemberDto, VideoDocumentSummaryDto } from '@/shared/contracts';
import { formMatchesFilter, type CreationLibraryFilter } from '@/renderer/components/creator/creationLibraryFilter';
import type { CreationItemProjection } from '@/renderer/components/creator/creationLibraryProjection';
import { matchesAuthor } from '@/shared/contracts/authorship';

export type AlbumContentEntry =
  | { kind: 'ALBUM'; album: AlbumDto }
  | { kind: 'CREATION'; creation: CreationItemProjection }
  | { kind: 'MATERIAL'; member: AlbumMemberDto }
  | { kind: 'DOCUMENT'; document: VideoDocumentSummaryDto };

export function albumContentKey(entry: AlbumContentEntry) {
  switch (entry.kind) {
    case 'ALBUM':
      return `album:${entry.album.id}`;
    case 'CREATION':
      return `creation:${entry.creation.key}`;
    case 'MATERIAL':
      return `material:${entry.member.id}`;
    case 'DOCUMENT':
      return `document:${entry.document.id}`;
  }
}

export function albumContentCount(entries: readonly AlbumContentEntry[], documentTotal: number) {
  const representedDocuments = new Set(
    entries.flatMap((entry) =>
      entry.kind === 'CREATION'
        ? entry.creation.orderedForms.flatMap((form) => (form.role === 'VIDEO_DOCUMENT' ? [form.entityRef.id] : []))
        : [],
    ),
  );
  const documentRows = entries.filter((entry) => entry.kind === 'DOCUMENT').length;
  return entries.length - documentRows + Math.max(documentRows, documentTotal - representedDocuments.size);
}

export function albumAuthorDocumentCount(
  albumId: string,
  creations: readonly CreationItemProjection[],
  filter: CreationLibraryFilter,
  documentTotal: number,
) {
  if (!albumContentFilters(filter).authorFiltered) return documentTotal;
  return new Set(
    creations
      .filter((creation) => creation.item.albumId === albumId)
      .flatMap((creation) =>
        creation.orderedForms.flatMap((form) =>
          form.role === 'VIDEO_DOCUMENT' && formMatchesFilter(form, filter) ? [form.entityRef.id] : [],
        ),
      ),
  ).size;
}

export function albumContentFilters(filter: CreationLibraryFilter) {
  const authorFiltered = Boolean(filter.author && filter.author !== 'ALL');
  return {
    authorFiltered,
    images: filter.images && !authorFiltered,
    documents: filter.documents,
  };
}

/** Creation-item ownership is authoritative, as it is in the creation directory. */
export function albumContentEntries(
  album: AlbumDto,
  childAlbums: readonly AlbumDto[],
  creations: readonly CreationItemProjection[],
  documents: readonly VideoDocumentSummaryDto[],
  filter: CreationLibraryFilter,
): AlbumContentEntry[] {
  const directCreations = creations
    .filter((creation) => creation.item.albumId === album.id)
    .filter((creation) => creation.orderedForms.some((form) => formMatchesFilter(form, filter)))
    // Document-only items are paginated by the document reader. Mixed items
    // retain all of their forms and count as a single creation.
    .filter((creation) => creation.orderedForms.some((form) => form.role !== 'VIDEO_DOCUMENT'))
    .sort(
      (left, right) =>
        Number(right.item.pinned) - Number(left.item.pinned) ||
        right.activityAt.localeCompare(left.activityAt) ||
        left.key.localeCompare(right.key),
    );
  const representedDocuments = new Set(
    directCreations.flatMap((creation) =>
      creation.orderedForms.flatMap((form) => (form.role === 'VIDEO_DOCUMENT' ? [form.entityRef.id] : [])),
    ),
  );
  const contentFilter = albumContentFilters(filter);
  const documentOwners = new Map(
    contentFilter.authorFiltered
      ? creations.flatMap((creation) =>
          creation.orderedForms.flatMap((form) =>
            form.role === 'VIDEO_DOCUMENT' ? [[form.entityRef.id, creation.item] as const] : [],
          ),
        )
      : [],
  );
  return [
    ...childAlbums.map((child): AlbumContentEntry => ({ kind: 'ALBUM', album: child })),
    ...directCreations.map((creation): AlbumContentEntry => ({ kind: 'CREATION', creation })),
    ...(contentFilter.images
      ? album.members
          .filter((member) => member.targetType === 'MATERIAL')
          .map((member): AlbumContentEntry => ({ kind: 'MATERIAL', member }))
      : []),
    ...(contentFilter.documents
      ? documents
          .filter((document) => !representedDocuments.has(document.id))
          .filter((document) =>
            matchesAuthor(
              documentOwners
                .get(document.id)
                ?.forms.find((form) => form.entity.kind === 'VIDEO_DOCUMENT' && form.entity.id === document.id)
                ?.authors ?? [],
              filter.author,
            ),
          )
          .map((document): AlbumContentEntry => ({ kind: 'DOCUMENT', document }))
      : []),
  ];
}
