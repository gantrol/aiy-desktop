import type { IpcRenderer } from 'electron';
import {
  keywordResultSchema,
  authorListResultSchema,
  authorSchema,
  creationAuthorStateSchema,
  meCommandSchema,
  userProfileSchema,
  type MeApi,
  type MeCommand,
} from '@/shared/contracts/me';

export function createMePreloadApi(ipc: Pick<IpcRenderer, 'invoke'>): MeApi {
  const invoke = (command: MeCommand) => ipc.invoke('me:command', meCommandSchema.parse(command));
  return {
    profile: async (spaceId) => userProfileSchema.parse(await invoke({ kind: 'profile-get', spaceId })),
    saveProfile: async (spaceId, profile) =>
      userProfileSchema.parse(await invoke({ kind: 'profile-save', spaceId, profile })),
    authors: async (input) =>
      authorListResultSchema.parse(await invoke(meCommandSchema.parse({ kind: 'authors-list', ...input }))),
    creationAuthor: async (spaceId, target) =>
      creationAuthorStateSchema.nullable().parse(await invoke({ kind: 'creation-author', spaceId, target })),
    setCreationAuthor: async (input) =>
      creationAuthorStateSchema.parse(await invoke({ kind: 'creation-author-set', ...input })),
    updateAuthor: async (input) => authorSchema.parse(await invoke({ kind: 'author-update', ...input })),
    keywords: async (input) =>
      keywordResultSchema.parse(await invoke(meCommandSchema.parse({ kind: 'keywords', ...input }))),
  };
}
