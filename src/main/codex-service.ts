import type {
  CodexAssistInput,
  CodexHealth,
  AssistantReasoningEffort,
  CodexTextModelDto,
  CodexTitleInput,
  CodexTitleResult,
  CreatorAgentChatInput,
  CreatorAgentScope,
  CreatorAgentTurnDto,
} from '@/shared/contracts';

export interface CodexTitleExecutionOptions {
  model?: string;
  effort?: AssistantReasoningEffort;
}

export interface CodexChatJob {
  scope: CreatorAgentScope;
  request: CreatorAgentChatInput;
  input: CodexAssistInput;
  history: CreatorAgentTurnDto[];
  imagePaths: string[];
}

export interface CodexService {
  readonly cachedHealth: CodexHealth;
  readonly hasPending: boolean;
  readonly pendingCount: number;

  onPendingChanged(listener: (activeCount: number) => void): () => void;
  refreshHealth(signal?: AbortSignal): Promise<CodexHealth>;
  listModels(signal?: AbortSignal): Promise<CodexTextModelDto[]>;
  chat(job: CodexChatJob, signal?: AbortSignal): Promise<CreatorAgentTurnDto>;
  suggestTitles(
    input: CodexTitleInput,
    options?: CodexTitleExecutionOptions,
    signal?: AbortSignal,
  ): Promise<CodexTitleResult>;
  cancelAll(): Promise<void>;
}
