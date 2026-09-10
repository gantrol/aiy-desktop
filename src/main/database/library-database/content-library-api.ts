import { ContentLibraryRepository } from '@/main/database/creations/content-library-repository';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { ContentLibraryCommand } from '@/shared/contracts/content-library';
import { ReadableContentRepository } from '@/main/database/assets/readable-content-repository';

export function createContentLibraryApi(repositories: LibraryDatabaseRepositories) {
  const content = new ContentLibraryRepository(repositories);
  const readable = new ReadableContentRepository(repositories, content);
  repositories.libraryFileView.attachContentProjection(readable);
  return {
    contentLibrary: content,
    ensureContentDirectory: (source: import('@/shared/contracts/content-library').ContentSource) =>
      readable.ensure(source),
    executeContentLibrary(command: Exclude<ContentLibraryCommand, { kind: 'reveal' | 'link-preview' | 'link-open' }>) {
      switch (command.kind) {
        case 'search':
          return content.search(command.query, command.offset);
        case 'read':
          return content.read(command.source);
        case 'capture':
          return content.capture(command);
        case 'references':
          return content.references(command.ids);
        case 'render':
          return content.render(command.markdown);
        case 'note-open':
          return content.noteOpen(command.id);
        case 'note-save':
          return content.noteSave(command.input);
        case 'note-checkpoint':
          return content.noteCheckpoint(command.input);
      }
    },
  };
}
