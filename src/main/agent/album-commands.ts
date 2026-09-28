import type { LibraryDatabase } from '@/main/database';
import type { MaterialAlbumDto } from '@/shared/contracts';
import {
  agentAlbumAddResultSchema,
  agentAlbumEnsureResultSchema,
  agentAlbumListResultSchema,
  agentAlbumRemoveResultSchema,
  type AgentAlbumAddRequest,
  type AgentAlbumEnsureRequest,
  type AgentAlbumListRequest,
  type AgentAlbumRemoveRequest,
} from '@/shared/contracts/agent-album';

function albumError(code: string) {
  return Object.assign(new Error(code), { code: `AIY_AGENT_ALBUM_${code}` });
}

function assertSpace(database: LibraryDatabase, spaceId: string, signal: AbortSignal) {
  signal.throwIfAborted();
  if (database.getLocalSpace().id !== spaceId) throw albumError('SPACE_CONFLICT');
}

function summary(album: MaterialAlbumDto) {
  return { id: album.id, title: album.title, parentId: album.parentId, materialCount: album.materialCount };
}

function collections(database: LibraryDatabase, locale: AgentAlbumListRequest['locale']) {
  return database.listMaterialAlbums({ locale }).filter((album) => album.kind === 'USER' && !album.readOnly);
}

export function listAgentAlbums(database: LibraryDatabase, input: AgentAlbumListRequest, signal: AbortSignal) {
  assertSpace(database, input.spaceId, signal);
  const albums = collections(database, input.locale).sort((left, right) => left.id.localeCompare(right.id));
  const end = input.offset + input.limit;
  return agentAlbumListResultSchema.parse({
    spaceId: input.spaceId,
    albums: albums.slice(input.offset, end).map(summary),
    nextOffset: end < albums.length ? end : null,
  });
}

/** Ensure is atomic and repeatable by active sibling title; ambiguous matches require an explicit album ID. */
export function ensureAgentAlbum(database: LibraryDatabase, input: AgentAlbumEnsureRequest, signal: AbortSignal) {
  return database.db
    .transaction(() => {
      assertSpace(database, input.spaceId, signal);
      const albums = collections(database, input.locale);
      if (input.parentAlbumId && !albums.some((album) => album.id === input.parentAlbumId)) {
        throw albumError('PARENT_NOT_FOUND');
      }
      const matches = albums.filter(
        (album) => album.title === input.title && album.parentId === (input.parentAlbumId ?? null),
      );
      if (matches.length > 1) throw albumError('TITLE_CONFLICT');
      const album =
        matches[0] ??
        database.createMaterialAlbum({
          title: input.title,
          locale: input.locale,
          ...(input.parentAlbumId ? { parentAlbumId: input.parentAlbumId } : {}),
        });
      return agentAlbumEnsureResultSchema.parse({
        spaceId: input.spaceId,
        album: summary(album),
        created: matches.length === 0,
      });
    })
    .immediate();
}

/** Existing membership writes validate every material and roll back the whole batch on failure. */
export function addAgentAlbumMaterials(database: LibraryDatabase, input: AgentAlbumAddRequest, signal: AbortSignal) {
  return database.db
    .transaction(() => {
      assertSpace(database, input.spaceId, signal);
      const materialIds = [...new Set(input.materialIds)];
      const album = database.addMaterialAlbumMembers({
        albumId: input.albumId,
        locale: input.locale,
        targets: materialIds.map((materialId) => ({ kind: 'MATERIAL', materialId })),
      });
      const members = new Set(album.members.map((member) => member.materialId));
      if (!materialIds.every((id) => members.has(id))) throw albumError('MEMBERSHIP_CONFLICT');
      return agentAlbumAddResultSchema.parse({ spaceId: input.spaceId, album: summary(album), materialIds });
    })
    .immediate();
}

/** Removal is idempotent and affects only membership in the selected collection. */
export function removeAgentAlbumMaterials(
  database: LibraryDatabase,
  input: AgentAlbumRemoveRequest,
  signal: AbortSignal,
) {
  return database.db
    .transaction(() => {
      assertSpace(database, input.spaceId, signal);
      const materialIds = [...new Set(input.materialIds)];
      const album = database.removeMaterialAlbumMembers({
        albumId: input.albumId,
        locale: input.locale,
        materialIds,
      });
      const members = new Set(album.members.map((member) => member.materialId));
      if (materialIds.some((id) => members.has(id))) throw albumError('MEMBERSHIP_CONFLICT');
      return agentAlbumRemoveResultSchema.parse({ spaceId: input.spaceId, album: summary(album), materialIds });
    })
    .immediate();
}
