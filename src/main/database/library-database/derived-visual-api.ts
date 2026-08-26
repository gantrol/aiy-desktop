import type { DerivedVisualAdoptInput, DerivedVisualWorkspaceOpenInput } from '@/shared/contracts';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';

export function createDerivedVisualApi(repositories: Pick<LibraryDatabaseRepositories, 'derivedVisuals'>) {
  return {
    listDerivedVisuals() {
      return repositories.derivedVisuals.list();
    },

    openDerivedVisualWorkspace(input: DerivedVisualWorkspaceOpenInput) {
      return repositories.derivedVisuals.openWorkspace(input);
    },

    adoptDerivedVisual(input: DerivedVisualAdoptInput) {
      return repositories.derivedVisuals.adopt(input);
    },
  };
}

export type DerivedVisualApi = ReturnType<typeof createDerivedVisualApi>;
