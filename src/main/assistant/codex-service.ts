import type { GifPlanRequest, GifPlanResult } from '@/shared/contracts/gif-motion-plan';
import type {
  ArticleCheckInput,
  ArticleCheckResult,
  CodexAssistInput,
  CodexHealth,
  AssistantReasoningEffort,
  CodexTextModelDto,
  CodexTitleInput,
  CodexTitleResult,
  CodexUsageQuotaSnapshot,
  CreatorAgentChatInput,
  CreatorAgentScope,
  CreatorAgentTurnDto,
} from '@/shared/contracts';

export interface CodexTitleExecutionOptions {
  model?: string;
  effort?: AssistantReasoningEffort;
}

export interface CodexGifPlanningExecutionOptions {
  model: string;
  effort: AssistantReasoningEffort;
}

export interface CodexArticleCheckExecutionOptions {
  model: string;
  effort: AssistantReasoningEffort;
}

export interface CodexChatJob {
  /**
   * Optional durable correlation key for compatibility callers. The worker
   * validates its running kind, scope, and frozen history before model work.
   * New foreground calls omit it so creation happens after worker recovery.
   */
  processId?: string;
  scope: CreatorAgentScope;
  request: CreatorAgentChatInput;
  input: CodexAssistInput;
  history: CreatorAgentTurnDto[];
  imagePaths: string[];
}

export interface CodexService {
  planGif(
    input: GifPlanRequest,
    options: CodexGifPlanningExecutionOptions,
    signal?: AbortSignal,
  ): Promise<GifPlanResult>;
  readonly cachedHealth: CodexHealth;
  readonly hasPending: boolean;
  readonly pendingCount: number;

  onPendingChanged(listener: (activeCount: number) => void): () => void;
  refreshHealth(signal?: AbortSignal): Promise<CodexHealth>;
  listModels(signal?: AbortSignal): Promise<CodexTextModelDto[]>;
  readUsageQuota?(signal?: AbortSignal): Promise<CodexUsageQuotaSnapshot>;
  chat(job: CodexChatJob, signal?: AbortSignal): Promise<CreatorAgentTurnDto>;
  suggestTitles(
    input: CodexTitleInput,
    options?: CodexTitleExecutionOptions,
    signal?: AbortSignal,
  ): Promise<CodexTitleResult>;
  checkArticle(
    input: ArticleCheckInput,
    options: CodexArticleCheckExecutionOptions,
    signal?: AbortSignal,
  ): Promise<ArticleCheckResult>;
  cancelAll(): Promise<void>;
}
