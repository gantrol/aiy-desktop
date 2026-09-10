import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import { PetalBoardRepository } from '@/main/database/creations/petal-board-repository';
export function createPetalBoardApi({ storage }: Pick<LibraryDatabaseRepositories, 'storage'>) {
  const board = new PetalBoardRepository(storage);
  return { petalBoard: board };
}
