import type { IpcRenderer } from 'electron';
import type { DesktopApi } from '@/shared/contracts';
import {
  evaluationSuiteCreateInputSchema,
  evaluationSuiteCreateResultSchema,
  evaluationSuiteGetInputSchema,
  evaluationSuiteGetResultSchema,
  evaluationSuiteListResultSchema,
  evaluationSuiteSaveInputSchema,
  evaluationSuiteSaveResultSchema,
} from '@/shared/contracts/evaluation-suite';

type EvaluationSuitePreloadApi = Pick<
  DesktopApi,
  'evaluationSuitesList' | 'evaluationSuiteGet' | 'evaluationSuiteCreate' | 'evaluationSuiteSave'
>;

export function createEvaluationSuitePreloadApi(ipcRenderer: IpcRenderer): EvaluationSuitePreloadApi {
  return {
    evaluationSuitesList: async () =>
      evaluationSuiteListResultSchema.parse(await ipcRenderer.invoke('evaluation-suites:list')),
    evaluationSuiteGet: async (input) =>
      evaluationSuiteGetResultSchema.parse(
        await ipcRenderer.invoke('evaluation-suite:get', evaluationSuiteGetInputSchema.parse(input)),
      ),
    evaluationSuiteCreate: async (input) =>
      evaluationSuiteCreateResultSchema.parse(
        await ipcRenderer.invoke('evaluation-suite:create', evaluationSuiteCreateInputSchema.parse(input)),
      ),
    evaluationSuiteSave: async (input) =>
      evaluationSuiteSaveResultSchema.parse(
        await ipcRenderer.invoke('evaluation-suite:save', evaluationSuiteSaveInputSchema.parse(input)),
      ),
  };
}
