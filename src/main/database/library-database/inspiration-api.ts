import type {
  InspirationStashMoveInput,
  InspirationStashSaveInput,
  InspirationStashSetArchivedInput,
} from '@/shared/contracts';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';

export function createInspirationApi(repositories: Pick<LibraryDatabaseRepositories, 'inspirationStashes'>) {
  return {
    listInspirationStashes() {
      return repositories.inspirationStashes.list();
    },

    saveInspirationStash(input: InspirationStashSaveInput) {
      return repositories.inspirationStashes.save(input);
    },

    moveInspirationStash(input: InspirationStashMoveInput) {
      return repositories.inspirationStashes.move(input);
    },

    setInspirationStashArchived(input: InspirationStashSetArchivedInput) {
      return repositories.inspirationStashes.setArchived(input);
    },
  };
}
