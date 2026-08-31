import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type {
  BackgroundIssueAcknowledgeInput,
  LegacyGenerationDismissalImportInput,
} from '@/shared/contracts/background-issue';

export function createBackgroundIssueApi(repositories: Pick<LibraryDatabaseRepositories, 'backgroundIssues'>) {
  return {
    acknowledgeBackgroundIssue(input: BackgroundIssueAcknowledgeInput) {
      return repositories.backgroundIssues.acknowledge(input);
    },

    importLegacyGenerationDismissals(input: LegacyGenerationDismissalImportInput) {
      return repositories.backgroundIssues.importLegacyGenerationDismissals(input);
    },
  };
}
