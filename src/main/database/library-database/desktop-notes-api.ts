import { DesktopNotesRepository } from '@/main/database/creations/desktop-notes-repository';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type {
  DesktopNoteDraft,
  DesktopNoteSave,
  DesktopNoteInitial,
  PetalColor,
  PetalIcon,
} from '@/shared/contracts/desktop-petals';

export function createDesktopNotesApi({
  storage,
  inspirationStashes,
  creationItems,
  articles,
}: Pick<LibraryDatabaseRepositories, 'storage' | 'inspirationStashes' | 'creationItems' | 'articles'>) {
  const notes = new DesktopNotesRepository(storage, articles);
  return {
    listDesktopNotes: () => notes.list(),
    listDesktopNoteSummaries: () => notes.summaries(),
    listDesktopNoteIds: (color?: PetalColor) => notes.activeIds(color),
    getDesktopNote: (id: string) => notes.get(id),
    removeDesktopNote: (id: string) => notes.remove(id),
    removeDesktopNotesByColor: (color: PetalColor) => notes.removeByColor(color),
    createDesktopNote: (requestId: string, stashId?: string, initial?: DesktopNoteInitial) =>
      notes.create(requestId, stashId, initial),
    reconcileDesktopNoteSources: (stashIds?: readonly string[]) => notes.reconcileSources(stashIds),
    saveDesktopNote: (input: DesktopNoteSave) => notes.save(input),
    updateDesktopNoteAppearance: (id: string, patch: { color?: PetalColor; icon?: PetalIcon }) =>
      notes.appearance(id, patch),
    checkpointDesktopNote: (input: DesktopNoteDraft) => notes.checkpoint(input),
    getDesktopNoteDraft: (id: string) => notes.draft(id),
    getDesktopNoteSource: (id: string) => {
      const note = notes.get(id);
      return {
        stash: inspirationStashes.get(note.stashId),
        article: articles.get(note.stashId),
        item: creationItems.findForEntity({ kind: 'ARTICLE', id: note.stashId }),
      };
    },
  };
}
