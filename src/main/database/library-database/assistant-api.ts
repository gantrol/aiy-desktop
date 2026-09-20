import type {
  AiProcessObservableEventInput,
  AiProcessTransport,
} from '@/main/database/assistant/ai-process-repository';
import type { LibraryDatabaseRepositories } from '@/main/database/library-database/repositories';
import type { CreateStyleExplorationFromRunsInput } from '@/main/database/assistant/style-exploration-repository';
import type {
  AssistantActivityPhase,
  AssistantCapabilityReceiptDto,
  AssistantProposalAdoptionInput,
  AssistantReasoningEffort,
  CodexAssistResult,
  CreationDraftCommitInput,
  CreationDraftSaveInput,
  CreationInputStashCreateInput,
  CreatorAgentAssistInput,
  CreatorAgentChatInput,
  CreatorAgentHistoryInput,
  CreatorAgentScope,
  DictionaryScopeResolveInput,
  GenerationInput,
  StyleExplorationStartInput,
} from '@/shared/contracts';

export function createAssistantApi(
  repositories: Pick<
    LibraryDatabaseRepositories,
    | 'aiProcesses'
    | 'assistantRuns'
    | 'creationInputStashes'
    | 'creations'
    | 'creatorAgent'
    | 'db'
    | 'dictionary'
    | 'directionExperimentTasks'
    | 'executionSnapshots'
    | 'intake'
    | 'styleExplorations'
    | 'workbench'
  >,
) {
  return {
    saveCreationDraft(input: CreationDraftSaveInput) {
      return repositories.intake.saveDraft(input);
    },

    commitCreationDraft(input: CreationDraftCommitInput) {
      const generationInput: GenerationInput = {
        seriesId: input.seriesId ?? null,
        baseVersionId: input.baseVersionId ?? null,
        creationDraftId: input.creationDraftId,
        inspirationStashId: input.inspirationStashId,
        imageBreakdownId: input.imageBreakdownId,
        title: input.title,
        titleLocale: input.termPromptLocale,
        manualPrompt: input.manualPrompt,
        document: input.document,
        promptNodes: input.promptNodes,
        prompt: input.prompt,
        resolvedPrompt: input.resolvedPrompt,
        changeSummary: input.changeSummary,
        referenceAssetIds: input.referenceAssetIds,
        termPromptLocale: input.termPromptLocale,
        termIds: input.termIds,
        wordPaletteReferences: input.wordPaletteReferences,
        modelKey: 'gpt-image-2',
        canvasPresetKey: null,
        width: null,
        height: null,
        quality: 'low',
      };
      const promptInput = repositories.executionSnapshots.captureCommonInput(generationInput);
      return repositories.workbench.saveCreationDraftAsV01(generationInput, promptInput);
    },

    listCreationInputStashes(scope: CreatorAgentScope) {
      return repositories.creationInputStashes.list(scope);
    },

    createCreationInputStash(input: CreationInputStashCreateInput) {
      return repositories.creationInputStashes.create(input);
    },

    resolveDictionaryScope(input: DictionaryScopeResolveInput) {
      return repositories.dictionary.resolveScope(input);
    },

    listCreatorAgentTurns(scope: CreatorAgentScope) {
      return repositories.creatorAgent.list(scope);
    },

    listCreatorAgentTurnPage(input: CreatorAgentHistoryInput) {
      return repositories.creatorAgent.page(input);
    },

    listRecentCreatorAgentChatTurns(scope: CreatorAgentScope, limit = 20) {
      return repositories.creatorAgent.recentChat(scope, limit);
    },

    addCreatorAgentTurn(scope: CreatorAgentScope, input: CreatorAgentChatInput, result: CodexAssistResult) {
      return repositories.creatorAgent.add(scope, input, result);
    },

    startAgentChatProcess(scope: CreatorAgentScope, historyTurnIds: readonly string[]) {
      return repositories.aiProcesses.startAgentChat(scope, historyTurnIds);
    },

    assertAgentChatProcessOwnership(processId: string, scope: CreatorAgentScope, historyTurnIds: readonly string[]) {
      repositories.aiProcesses.assertAgentChatOwnership(processId, scope, historyTurnIds);
    },

    setAgentChatProcessTransport(processId: string, transport: AiProcessTransport) {
      repositories.aiProcesses.setTransport(processId, transport);
    },

    recordAgentChatExternalTurn(processId: string, threadId: string, turnId: string) {
      repositories.aiProcesses.recordExternalTurn(processId, threadId, turnId);
    },

    recordAgentChatProcessEvent(processId: string, event: AiProcessObservableEventInput) {
      repositories.aiProcesses.recordObservableEvent(processId, event);
    },

    markAgentChatCaptureDegraded(
      processId: string,
      reason: string,
      droppedEventCount = 0,
      droppedEventCountExact = true,
    ) {
      repositories.aiProcesses.markCaptureDegraded(processId, reason, droppedEventCount, droppedEventCountExact);
    },

    completeAgentChatProcess(
      processId: string,
      scope: CreatorAgentScope,
      input: CreatorAgentChatInput,
      result: CodexAssistResult,
    ) {
      return repositories.db.transaction(() => {
        const turn = repositories.creatorAgent.add(scope, input, result);
        repositories.aiProcesses.succeed(processId, turn.id);
        return turn;
      })();
    },

    failAgentChatProcess(processId: string, error: unknown) {
      repositories.aiProcesses.finishFromError(processId, error);
    },

    startAssistantRun(
      input: CreatorAgentAssistInput,
      contextHash: string,
      capabilityReceipt: AssistantCapabilityReceiptDto,
      execution?: { providerKey: string; modelKey: string; reasoningEffort?: AssistantReasoningEffort | null },
    ) {
      return repositories.db.transaction(() => {
        const usesCreation = input.mode === 'directions' && !input.sourceExperimentSlotId;
        const requestedCreation =
          usesCreation && input.creationId ? repositories.creations.get(input.creationId) : null;
        if (usesCreation && input.creationId && !requestedCreation) throw new Error('Creation not found');
        const creation = usesCreation
          ? (requestedCreation ??
            repositories.creations.startForDirections({
              scope: input.scope,
              contextKey: input.contextKey,
              briefText: input.prompt,
              locale: input.locale,
            }))
          : null;
        const run = repositories.assistantRuns.start(input, contextHash, capabilityReceipt, execution);
        if (!creation) return run;
        repositories.creations.attachAssistantRun(creation.id, run.id);
        return repositories.assistantRuns.get(run.id)!;
      })();
    },

    succeedAssistantRun(runId: string, result: CodexAssistResult) {
      return repositories.db.transaction(() => {
        const run = repositories.assistantRuns.succeed(runId, result);
        if (run.proposal) repositories.creations.completeAssistantRun(runId, run.proposal.id, result.directions.length);
        return repositories.assistantRuns.get(runId)!;
      })();
    },

    getAssistantRun(runId: string) {
      return repositories.assistantRuns.get(runId);
    },

    failAssistantRun(runId: string, errorMessage: string) {
      return repositories.db.transaction(() => {
        repositories.assistantRuns.fail(runId, errorMessage);
        repositories.creations.failAssistantRun(runId, errorMessage);
        return repositories.assistantRuns.get(runId)!;
      })();
    },

    interruptAssistantRun(runId: string, errorMessage: string) {
      return repositories.db.transaction(() => {
        repositories.assistantRuns.interrupt(runId, errorMessage);
        repositories.creations.failAssistantRun(runId, errorMessage, true);
        return repositories.assistantRuns.get(runId)!;
      })();
    },

    recordAssistantActivity(
      runId: string,
      phase: AssistantActivityPhase,
      details: {
        providerKey?: string | null;
        modelKey?: string | null;
        message?: string;
        payload?: Record<string, unknown>;
      } = {},
    ) {
      return repositories.creations.recordForAssistantRun(runId, phase, details);
    },

    expireAssistantProposal(runId: string, currentContextKey: string) {
      return repositories.assistantRuns.expireProposal(runId, currentContextKey);
    },

    revalidateAssistantProposal(runId: string, currentContextKey: string) {
      return repositories.assistantRuns.revalidateProposal(runId, currentContextKey);
    },

    adoptAssistantProposal(input: AssistantProposalAdoptionInput) {
      return repositories.db
        .transaction(() => {
          const run = repositories.assistantRuns.get(input.runId);
          if (!run) throw new Error(`Assistant run not found: ${input.runId}`);
          if (input.persistence?.kind === 'DRAFT') {
            if (run.scope.kind !== 'DRAFT' || input.persistence.draft.id !== run.scope.id) {
              throw new Error('Assistant proposal draft persistence does not match its creation scope');
            }
            repositories.intake.saveDraft(input.persistence.draft);
          } else if (input.persistence?.kind === 'SERIES') {
            if (run.scope.kind !== 'SERIES' || input.persistence.version.seriesId !== run.scope.id) {
              throw new Error('Assistant proposal version persistence does not match its creation scope');
            }
            const promptInput = repositories.executionSnapshots.captureCommonInput(input.persistence.version);
            repositories.workbench.savePromptVersion(input.persistence.version, promptInput);
          }
          return repositories.assistantRuns.adoptProposal(input);
        })
        .immediate();
    },

    closeAssistantProposal(runId: string) {
      return repositories.assistantRuns.closeProposal(runId);
    },

    dismissAssistantRun(runId: string) {
      return repositories.assistantRuns.dismiss(runId);
    },

    listAssistantRuns(scope?: CreatorAgentScope) {
      return scope ? repositories.assistantRuns.list(scope) : repositories.assistantRuns.listRecent();
    },

    listCreations() {
      return repositories.creations.list();
    },

    deleteCreation(id: string) {
      repositories.creations.delete(id);
    },

    createStyleExplorationBatch(input: CreateStyleExplorationFromRunsInput) {
      return repositories.styleExplorations.createFromPreparedRuns(input);
    },

    validateStyleExplorationStart(input: StyleExplorationStartInput) {
      const promptSnapshots = input.slots.map((slot) => repositories.executionSnapshots.captureCommonInput(slot.input));
      repositories.styleExplorations.validateStart(input, promptSnapshots);
    },

    listStyleExplorationBatches(scope?: CreatorAgentScope) {
      return scope ? repositories.styleExplorations.list(scope) : repositories.styleExplorations.listAll();
    },

    listDirectionExperimentDirectorTasks() {
      return repositories.directionExperimentTasks.list();
    },

    getStyleExplorationBatch(batchId: string) {
      return repositories.styleExplorations.get(batchId);
    },

    getStyleExplorationSlot(slotId: string) {
      return repositories.styleExplorations.getSlot(slotId);
    },

    styleExplorationRunIds(batchId: string) {
      return repositories.styleExplorations.runIdsForBatch(batchId);
    },

    retryableStyleExplorationRunIds(slotId: string) {
      return repositories.styleExplorations.retryableRunIdsForSlot(slotId);
    },

    styleExplorationSlotIdForRun(runId: string) {
      return repositories.styleExplorations.slotIdForRun(runId);
    },

    linkStyleExplorationRetry(slotId: string, runId: string) {
      return repositories.styleExplorations.linkRetryRun(slotId, runId);
    },
  };
}

export type AssistantApi = ReturnType<typeof createAssistantApi>;
