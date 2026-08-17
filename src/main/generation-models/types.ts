import type {
  GenerationExecutionRoute,
  GenerationInput,
  ImageGenerationRouteDto,
  ProviderReturnedDescriptionInput,
} from '@/shared/contracts';

export interface GenerationModelResultMetadata {
  providerReturnedDescriptions?: readonly ProviderReturnedDescriptionInput[];
  providerRequestId?: string;
  continuation?: Readonly<{
    providerKey: string;
    modelId: string;
    schemaVersion: number;
    payload: unknown;
  }>;
}

export type GenerationModelResult =
  | ({ kind: 'FILE'; outputPath: string } & GenerationModelResultMetadata)
  | ({ kind: 'LIBRARY_ASSET'; sourceAssetId: string } & GenerationModelResultMetadata);

export type GenerationStarted = (cancel?: () => void) => void;

export type GenerationExecutionSignal =
  | { type: 'REQUEST_IDENTIFIED'; providerRequestId: string }
  | { type: 'REMOTE_OPERATION_ACCEPTED'; providerRequestId: string }
  /** @deprecated Compatibility alias for REQUEST_IDENTIFIED. */
  | { type: 'REQUEST_ACCEPTED'; providerRequestId?: string }
  | {
      type: 'PROGRESS';
      stage: 'PREPARING' | 'UPLOADING' | 'GENERATING' | 'DOWNLOADING' | 'FINALIZING';
      progress?: number;
      message?: string;
    }
  | { type: 'WARNING'; code: string; message: string };

export type GenerationExecutionObserver = (signal: GenerationExecutionSignal) => void;

/** Exact client-side request frozen before execute crosses the model boundary. */
export interface GenerationExecutionRequestSnapshot {
  route: GenerationExecutionRoute;
  requestSchema: string;
  actualRequest: unknown;
  /** Audit text for the transport request; it may be an execution envelope and is not necessarily an image Prompt. */
  clientRequestText?: string | null;
}

export interface PreparedGenerationExecution {
  requestSnapshot: GenerationExecutionRequestSnapshot;
  execute(onStarted: GenerationStarted, onSignal?: GenerationExecutionObserver): Promise<GenerationModelResult>;
  /** Released by the coordinator after a FILE result has been copied into durable storage. */
  cleanup?: () => void;
}

/** Executable route: a model plus the provider and transport used to invoke it. */
export interface ImageGenerationRoute {
  readonly descriptor: ImageGenerationRouteDto;
  /** Synchronous route admission check performed before a run is persisted or queued. */
  validateInput?(
    input: Readonly<Pick<GenerationInput, 'modelKey' | 'width' | 'height' | 'quality'>>,
    routeSnapshot?: Readonly<ImageGenerationRouteDto>,
  ): void;
  prepareExecution(
    runId: string,
    input: GenerationInput,
    routeSnapshot?: Readonly<ImageGenerationRouteDto>,
  ): PreparedGenerationExecution | Promise<PreparedGenerationExecution>;
}

/** @deprecated Use ImageGenerationRoute. */
export type GenerationModel = ImageGenerationRoute;

export interface GenerationProviderDefinition {
  readonly id: string;
  readonly name: string;
  readonly extensionId: string | null;
}

export interface GenerationProvider {
  readonly definition: GenerationProviderDefinition;
  /** @deprecated Use definition.id. */
  readonly key: string;
  /** @deprecated Use definition.name. */
  readonly name: string;
  routes(): readonly ImageGenerationRoute[];
}
