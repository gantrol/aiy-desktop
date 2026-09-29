import type { LibraryStorage } from '@/main/database/core/storage';
import type { ContentLibraryRepository } from '@/main/database/creations/content-library-repository';
import { KeywordIndex } from '@/main/database/me/keyword-index';
import { readUserProfile, saveUserProfile } from '@/main/database/me/user-profile';
import { meCommandSchema, type MeCommand } from '@/shared/contracts/me';
import { AuthorRepository } from '@/main/database/me/author-repository';

export function createMeApi(storage: LibraryStorage, content: ContentLibraryRepository) {
  const keywords = new KeywordIndex(storage.db, (source) => content.read(source));
  const authors = new AuthorRepository(storage);
  return {
    executeMe(raw: MeCommand) {
      const command = meCommandSchema.parse(raw);
      const space = storage.db.prepare('SELECT id FROM local_spaces WHERE singleton_key=1').pluck().get();
      if (space !== command.spaceId) throw new Error('ME_SPACE_CHANGED');
      if (command.kind === 'profile-get') return readUserProfile(storage.db);
      if (command.kind === 'profile-save') return saveUserProfile(storage, command.profile);
      if (command.kind === 'authors-list') return authors.list(command);
      if (command.kind === 'creation-author') return authors.forTarget(command.target);
      if (command.kind === 'creation-author-set') return authors.assign(command);
      if (command.kind === 'author-update') return authors.update(command);
      return keywords.query(command);
    },
  };
}
