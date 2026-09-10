import type { AgentCommandKind } from '@/main/database/generation/agent-command-repository';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { AgentGenerationDraft } from '@/shared/contracts/agent-cli';
import type { AgentIntakeGetRequest, AgentIntakeImportRequest } from '@/shared/contracts/agent-intake';

export function createAgentApi(repositories: Pick<LibraryDatabaseRepositories, 'agentCommands' | 'agentIntake'>) {
  return {
    importAgentIntake(request: AgentIntakeImportRequest, signal: AbortSignal) {
      return repositories.agentIntake.import(request, signal);
    },

    getAgentIntake(request: AgentIntakeGetRequest) {
      return repositories.agentIntake.get(request);
    },

    getAgentCommand(requestId: string) {
      return repositories.agentCommands.getCommand(requestId);
    },

    recordAgentCommand(requestId: string, command: AgentCommandKind, inputHash: string, result: unknown) {
      return repositories.agentCommands.recordCommand(requestId, command, inputHash, result);
    },

    createAgentGenerationDraft(id: string, draft: AgentGenerationDraft) {
      return repositories.agentCommands.createDraft(id, draft);
    },

    createAgentGenerationDraftForCommand(
      requestId: string,
      inputHash: string,
      id: string,
      draft: AgentGenerationDraft,
      createdAt: string,
      result: unknown,
    ) {
      return repositories.agentCommands.createDraftForCommand(requestId, inputHash, id, draft, createdAt, result);
    },

    getAgentGenerationJob(id: string) {
      return repositories.agentCommands.getJob(id);
    },

    markAgentGenerationJobStarted(id: string, runIds: readonly string[]) {
      return repositories.agentCommands.markStarted(id, runIds);
    },

    markAgentGenerationJobStartedForCommand(
      requestId: string,
      inputHash: string,
      id: string,
      runIds: readonly string[],
      result: unknown,
    ) {
      return repositories.agentCommands.markStartedForCommand(requestId, inputHash, id, runIds, result);
    },
  };
}
