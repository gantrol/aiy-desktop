import type { DerivedVisualAdoptInput, DerivedVisualWorkspaceOpenInput } from '@/shared/contracts';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type {
  DerivedVisualOperationIdentity,
  DerivedVisualOperationsListInput,
  DerivedVisualUndoInput,
  DerivedVisualOperationRequest,
} from '@/shared/contracts/derived-visual-operations';

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
    undoDerivedVisual(input: DerivedVisualUndoInput) {
      return repositories.derivedVisuals.operations.execute({ ...input, kind: 'UNDO' });
    },
    getDerivedVisualOperation(input: DerivedVisualOperationIdentity) {
      return repositories.derivedVisuals.operations.get(input);
    },
    listDerivedVisualOperations(input: DerivedVisualOperationsListInput) {
      return repositories.derivedVisuals.operations.list(input);
    },
    cancelDerivedVisualOperation(input: DerivedVisualOperationRequest) {
      return repositories.derivedVisuals.operations.cancel(input);
    },
  };
}

export type DerivedVisualApi = ReturnType<typeof createDerivedVisualApi>;
