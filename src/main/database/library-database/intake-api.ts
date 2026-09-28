import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import { listCreationDrafts } from '@/main/database/creations/creation-draft-list';
import { deleteCreationDrafts, restoreCreationDrafts } from '@/main/database/creations/creation-draft-deletion';
import type { CreationDraftDeleteInput, CreationDraftDeletion } from '@/shared/contracts/creation-draft-deletion';
import type { CreationDraftListInput } from '@/shared/contracts/creation-draft-list';
import { emptyAlbumCreationDefaults } from '@/shared/album-creation-defaults';
import type { CreationDraftLoadInput, CreationDraftStartInput, IntakeCommitInput, Locale } from '@/shared/contracts';

export function createIntakeApi(
  repositories: Pick<LibraryDatabaseRepositories, 'albums' | 'intake' | 'packs' | 'workbench' | 'db' | 'storage'>,
) {
  return {
    getWorkbench(
      locale: Locale = 'zh',
      options: { includeExecutionActualRequest?: boolean; includeExecutionInputSnapshot?: boolean } = {},
    ) {
      return { ...repositories.workbench.getWorkbench(locale, options), albums: repositories.albums.list(locale) };
    },

    isLibraryEmpty() {
      return repositories.intake.isLibraryEmpty();
    },

    getCreationDraft() {
      return repositories.intake.latestDraft();
    },

    listCreationDrafts(input: CreationDraftListInput) {
      return listCreationDrafts(repositories.db, input);
    },

    deleteCreationDrafts(input: CreationDraftDeleteInput) {
      return deleteCreationDrafts(repositories.storage, input);
    },

    restoreCreationDrafts(input: CreationDraftDeletion) {
      return restoreCreationDrafts(repositories.storage, input);
    },

    loadCreationDraft(input: CreationDraftLoadInput) {
      return repositories.intake.loadDraft(input.draftId);
    },

    startCreationDraft(input: CreationDraftStartInput) {
      const album = input.albumId ? repositories.albums.getActive(input.albumId) : null;
      const defaults = album?.creationDefaults ?? emptyAlbumCreationDefaults();
      if (defaults.dictionaryScope.mode === 'SELECTED') {
        const activeSources = repositories.packs
          .listContextPackActivations('ALBUM', album!.id)
          .filter((activation) => activation.state === 'EXPLICIT_ACTIVE');
        const installations = repositories.packs.listPackInstallations();
        for (const source of defaults.dictionaryScope.sources) {
          if (
            !activeSources.some(
              (activation) => activation.packId === source.packId && activation.packReleaseId === source.packReleaseId,
            )
          ) {
            throw new Error('An album dictionary source is unavailable');
          }
          if (
            !installations.some(
              (installation) =>
                installation.packId === source.packId &&
                installation.selectedReleaseId === source.packReleaseId &&
                installation.state === 'INSTALLED' &&
                installation.deletedAt === null,
            )
          ) {
            throw new Error('An album dictionary source is disabled');
          }
        }
      }
      return repositories.intake.startDraft(input, defaults);
    },

    commitIntake(input: IntakeCommitInput) {
      return repositories.intake.commit(input);
    },
  };
}

export type IntakeApi = ReturnType<typeof createIntakeApi>;
