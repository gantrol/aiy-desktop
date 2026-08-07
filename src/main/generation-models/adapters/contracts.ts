import type {
  GenerationInput,
  ImageGenerationRouteCapability,
  ImageGenerationRouteDto,
  GenerationQuality,
  ProviderReturnedDescriptionInput,
} from '@/shared/contracts';

export const generationMediaRoles = ['EDIT_SOURCE', 'REFERENCE', 'ANNOTATION_GUIDE', 'MASK'] as const;

export type GenerationMediaRole = (typeof generationMediaRoles)[number];

export type NormalizedGenerationOperation = 'GENERATE' | 'EDIT';

/** A provider-neutral image input. Adapters decide how each role maps to their API. */
export interface NormalizedGenerationMedia {
  assetId: string;
  role: GenerationMediaRole;
  localPath: string;
  mimeType: string;
  width?: number;
  height?: number;
}

export interface ProviderContinuationState {
  providerKey: string;
  modelId: string;
  schemaVersion: number;
  payload: unknown;
}

/** The stable request boundary between the workbench and provider adapters. */
export interface NormalizedGenerationRequest {
  runId: string;
  modelKey: string;
  providerKey: string;
  modelId: string;
  operation: NormalizedGenerationOperation;
  prompt: string;
  media: readonly NormalizedGenerationMedia[];
  output: Readonly<{
    width: number | null;
    height: number | null;
    quality: GenerationQuality;
    transparentBackground?: boolean;
  }>;
  /** Non-secret provider parameters frozen into the execution snapshot. */
  providerOptions?: Readonly<Record<string, unknown>>;
  continuation?: Readonly<ProviderContinuationState> | null;
}

export type GenerationAdapterStage = 'PREPARING' | 'UPLOADING' | 'GENERATING' | 'DOWNLOADING' | 'FINALIZING';

/** Signals emitted by an adapter while it owns a request. */
export type GenerationAdapterSignal =
  | {
      type: 'REQUEST_ACCEPTED';
      providerRequestId?: string;
    }
  | {
      type: 'PROGRESS';
      stage: GenerationAdapterStage;
      progress?: number;
      message?: string;
    }
  | {
      type: 'WARNING';
      code: string;
      message: string;
    };

export interface GenerationAdapterResultMetadata {
  providerRequestId?: string;
  continuation?: Readonly<ProviderContinuationState>;
  responseMetadata?: Readonly<Record<string, unknown>>;
  providerReturnedDescriptions?: readonly ProviderReturnedDescriptionInput[];
}

export type GenerationAdapterResult =
  | ({
      kind: 'FILE';
      outputPath: string;
      mimeType?: string;
    } & GenerationAdapterResultMetadata)
  | ({
      kind: 'LIBRARY_ASSET';
      sourceAssetId: string;
      relationType?: string;
    } & GenerationAdapterResultMetadata);

export interface GenerationAdapterExecutionContext {
  signal: AbortSignal;
  emit(signal: GenerationAdapterSignal): void;
}

/** Provider-specific code implements this interface without depending on workbench storage. */
export interface GenerationAdapter {
  readonly providerKey: string;
  readonly capabilities: readonly ImageGenerationRouteCapability[];
  readonly maxReferenceImages: number | null;
  validateRequest?(request: NormalizedGenerationRequest): void;
  execute(
    request: NormalizedGenerationRequest,
    context: GenerationAdapterExecutionContext,
  ): Promise<GenerationAdapterResult>;
}

export interface GenerationRequestFactoryContext {
  runId: string;
  input: Readonly<GenerationInput>;
  route: Readonly<ImageGenerationRouteDto>;
}

export type GenerationRequestFactory = (
  context: GenerationRequestFactoryContext,
) => NormalizedGenerationRequest | Promise<NormalizedGenerationRequest>;
