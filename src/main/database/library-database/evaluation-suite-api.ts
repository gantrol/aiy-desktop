import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { EvaluationSuiteCreateInput, EvaluationSuiteSaveInput } from '@/shared/contracts/evaluation-suite';

export function createEvaluationSuiteApi(repositories: Pick<LibraryDatabaseRepositories, 'evaluationSuites'>) {
  return {
    listEvaluationSuites() {
      return repositories.evaluationSuites.list();
    },

    getEvaluationSuite(id: string) {
      return repositories.evaluationSuites.get(id);
    },

    createEvaluationSuite(input: EvaluationSuiteCreateInput) {
      return repositories.evaluationSuites.create(input);
    },

    saveEvaluationSuite(input: EvaluationSuiteSaveInput) {
      return repositories.evaluationSuites.save(input);
    },
  };
}
