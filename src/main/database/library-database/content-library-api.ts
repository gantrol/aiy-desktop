import { ContentLibraryRepository } from '@/main/database/creations/content-library-repository';
import { ContentReferenceTargets } from '@/main/database/creations/content-reference-targets';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { ContentLibraryCommand } from '@/shared/contracts/content-library';
import { ReadableContentRepository } from '@/main/database/assets/readable-content-repository';
import { ContentSearchRepository } from '@/main/database/search/content-search-repository';

export function createContentLibraryApi(repositories: LibraryDatabaseRepositories) {
  const content = new ContentLibraryRepository(repositories);
  const search = new ContentSearchRepository(repositories.db, (source) => content.read(source));
  const references = new ContentReferenceTargets(repositories, content);
  const readable = new ReadableContentRepository(repositories, content);
  repositories.libraryFileView.attachContentProjection(readable);
  return {
    contentLibrary: content,
    ensureContentDirectory: (source: import('@/shared/contracts/content-library').ContentSource) =>
      readable.ensure(source),
    executeContentLibrary(
      command: Exclude<
        ContentLibraryCommand,
        { kind: 'reveal' | 'link-preview' | 'link-open' | 'reference-copy' | 'agent-link' }
      >,
    ) {
      switch (command.kind) {
        case 'lookup':
          return search.lookup(command.input);
        case 'reference-search':
          return references.search(command);
        case 'reference-inspect':
          return references.inspect(command.target);
        case 'reference-open':
          return references.open(command.target, command.referenceId);
        case 'reference-capture':
          return references.capture(command.target, command.expectedVersion);
        case 'reference-uses':
          return references.uses(command.target, command.offset);
        case 'search':
          return content.search(command.query, command.offset);
        case 'read':
          return content.read(command.source);
        case 'read-current':
          return content.readCurrent(command.source);
        case 'capture':
          return content.capture(command);
        case 'references':
          return content.references(command.ids);
        case 'render':
          if (
            command.expectedSpaceId !== undefined &&
            repositories.db.prepare('SELECT id FROM local_spaces WHERE singleton_key = 1').pluck().get() !==
              command.expectedSpaceId
          ) {
            return { errorCode: 'CONTENT_LIBRARY_SPACE_CHANGED' as const };
          }
          return content.render(command.markdown);
        case 'note-open':
          return content.noteOpen(command.id);
        case 'note-save':
          return content.noteSave(command.input);
        case 'note-checkpoint':
          return content.noteCheckpoint(command.input);
        case 'note-comment-mutate':
          return content.noteCommentMutate(command.input);
      }
    },
  };
}
