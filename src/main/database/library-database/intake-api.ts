import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import { emptyAlbumCreationDefaults } from '@/shared/album-creation-defaults';
import type { CreationDraftStartInput, IntakeCommitInput, Locale } from '@/shared/contracts';

export function createIntakeApi(
  repositories: Pick<LibraryDatabaseRepositories, 'albums' | 'intake' | 'packs' | 'workbench'>,
) {
  return {
    getWorkbench(locale: Locale = 'zh', options: { includeExecutionActualRequest?: boolean } = {}) {
      return { ...repositories.workbench.getWorkbench(locale, options), albums: repositories.albums.list(locale) };
    },

    isLibraryEmpty() {
      return repositories.intake.isLibraryEmpty();
    },

    getCreationDraft() {
      return repositories.intake.latestDraft();
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
