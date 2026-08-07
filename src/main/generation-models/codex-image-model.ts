import type { GenerationInput, ImageGenerationRouteDto } from '@/shared/contracts';
import {
  CODEX_APP_SERVER_IMAGE_MODEL_KEY,
  CODEX_APP_SERVER_PROVIDER_KEY,
  CODEX_CLI_IMAGE_MODEL_KEY,
  CODEX_CLI_PROVIDER_KEY,
  CODEX_IMAGE_MODEL_ID,
} from '@/shared/extension-ids';
import type { CodexAdapter, CodexImageExecutionMode } from '@/main/codex';
import type {
  GenerationExecutionObserver,
  GenerationStarted,
  ImageGenerationRoute,
} from '@/main/generation-models/types';

export class CodexImageModel implements ImageGenerationRoute {
  constructor(
    private readonly codex: CodexAdapter,
    private readonly executionMode: CodexImageExecutionMode = 'cli',
  ) {}

  get descriptor(): ImageGenerationRouteDto {
    const appServer = this.executionMode === 'app-server';
    return {
      key: appServer ? CODEX_APP_SERVER_IMAGE_MODEL_KEY : CODEX_CLI_IMAGE_MODEL_KEY,
      name: appServer ? 'Codex App Server' : 'Codex CLI',
      provider: 'Codex',
      providerKey: appServer ? CODEX_APP_SERVER_PROVIDER_KEY : CODEX_CLI_PROVIDER_KEY,
      modelId: CODEX_IMAGE_MODEL_ID,
      state: this.codex.cachedHealth.state === 'ready' ? 'READY' : 'UNAVAILABLE',
      availabilityReason: this.codex.cachedHealth.state === 'ready' ? null : 'CODEX_UNAVAILABLE',
      releaseStage: 'STABLE',
      internal: false,
      maxReferenceImages: 8,
      capabilities: ['GENERATE', 'REFERENCE_IMAGE', 'MULTI_REFERENCE', 'IMAGE_EDIT'],
      qualityMode: 'PROVIDER_MANAGED',
      supportedQualities: [],
    };
  }

  async prepareExecution(runId: string, input: GenerationInput) {
    const prepared = await this.codex.prepareGeneration(runId, input, this.executionMode);
    const appServer = 'transport' in prepared.request && prepared.request.transport === 'CODEX_APP_SERVER';
    const clientRequestText = 'turnInput' in prepared.request ? prepared.request.turnInput : prepared.request.stdin;
    return {
      requestSnapshot: {
        route: appServer ? ('PROVIDER_ADAPTER' as const) : ('CODEX_CLI' as const),
        requestSchema: appServer
          ? input.sourceAssetId
            ? 'codex-app-server-image-refinement.v1'
            : 'codex-app-server-imagegen.v1'
          : 'codex-cli-imagegen.v1',
        actualRequest: prepared.request,
        clientRequestText,
      },
      execute: async (onStarted: GenerationStarted, onSignal?: GenerationExecutionObserver) => ({
        kind: 'FILE' as const,
        outputPath: await prepared.execute(onStarted, (progress) =>
          onSignal?.({
            type: 'PROGRESS',
            stage: progress.stage,
            message: progress.message,
          }),
        ),
      }),
      cleanup: prepared.cleanup,
    };
  }
}
