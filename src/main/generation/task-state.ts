import type {
  GenerationInput,
  GenerationTaskPhase,
  ImageGenerationRouteDto,
  PromptCommonInputDto,
} from '@/shared/contracts';
import type { ImageGenerationRoute } from '@/main/generation-models';

export interface PendingGeneration {
  runId: string;
  seriesId: string;
  versionId: string;
  input: GenerationInput;
  promptInput: PromptCommonInputDto;
  route: ImageGenerationRoute;
  routeDescriptor: ImageGenerationRouteDto;
  modelKey: string;
  maxConcurrent: number;
  batchId: string | null;
  batchPosition: number | null;
  batchTotal: number | null;
  batchModelKeys: string[];
  status: 'QUEUED' | 'RUNNING';
  phase: GenerationTaskPhase;
  progress: number | null;
  cancelExecution: (() => void) | null;
  cancelled: boolean;
  submittedAt: string;
  startedAt: string | null;
  updatedAt: string;
  sequence: number;
}

export type PendingGenerationLaunch = Pick<
  PendingGeneration,
  'runId' | 'seriesId' | 'versionId' | 'input' | 'promptInput'
> &
  Partial<Pick<PendingGeneration, 'batchId' | 'batchPosition' | 'batchTotal' | 'batchModelKeys'>>;
