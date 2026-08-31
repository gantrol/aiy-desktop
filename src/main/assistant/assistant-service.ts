import type {
  AssistantActivityEventDto,
  AssistantReasoningEffort,
  AssistantRunDto,
  CodexTitleInput,
  CodexTitleResult,
  ImageBreakdownResult,
  ImageBreakdownWorkerInput,
} from '@/shared/contracts';

export interface AssistantTitleExecution {
  providerKey: string;
  modelKey: string;
  reasoningEffort: AssistantReasoningEffort | null;
}

/** Provider-neutral entry point owned by the Agent/model layer. */
export interface AssistantService {
  run(runId: string): Promise<AssistantRunDto>;
  suggestTitles(input: CodexTitleInput, execution: AssistantTitleExecution): Promise<CodexTitleResult>;
  imageBreakdown(input: ImageBreakdownWorkerInput): Promise<ImageBreakdownResult>;
  onProgress(listener: (event: AssistantActivityEventDto) => void): () => void;
}
