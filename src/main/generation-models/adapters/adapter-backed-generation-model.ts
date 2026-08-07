import type { GenerationInput, ImageGenerationRouteDto } from '@/shared/contracts';
import type {
  GenerationExecutionObserver,
  GenerationStarted,
  ImageGenerationRoute,
} from '@/main/generation-models/types';
import { effectiveImageGenerationRouteDescriptor } from '@/main/generation-models/adapters/capabilities';
import type {
  GenerationAdapter,
  GenerationAdapterResult,
  GenerationAdapterSignal,
  GenerationRequestFactory,
  NormalizedGenerationRequest,
} from '@/main/generation-models/adapters/contracts';
import {
  GenerationAdapterError,
  normalizeGenerationAdapterError,
  serializeGenerationAdapterError,
  type GenerationAdapterErrorDto,
} from '@/main/generation-models/adapters/errors';
import {
  validateGenerationAdapterRequest,
  validateGenerationAdapterResult,
} from '@/main/generation-models/adapters/validation';

export type GenerationAdapterEvent =
  | { type: 'STARTED'; runId: string; timestamp: string }
  | { type: 'REQUEST_ACCEPTED'; runId: string; timestamp: string; providerRequestId?: string }
  | {
      type: 'PROGRESS';
      runId: string;
      timestamp: string;
      stage: Extract<GenerationAdapterSignal, { type: 'PROGRESS' }>['stage'];
      progress?: number;
      message?: string;
    }
  | { type: 'WARNING'; runId: string; timestamp: string; code: string; message: string }
  | {
      type: 'COMPLETED';
      runId: string;
      timestamp: string;
      result: GenerationAdapterResult;
    }
  | {
      type: 'FAILED';
      runId: string;
      timestamp: string;
      error: GenerationAdapterErrorDto;
    };

export interface AdapterBackedGenerationModelOptions {
  descriptor: ImageGenerationRouteDto | (() => ImageGenerationRouteDto);
  adapter: GenerationAdapter;
  createRequest: GenerationRequestFactory;
  cleanup?(request: NormalizedGenerationRequest): void;
  onEvent?(event: GenerationAdapterEvent): void;
  now?: () => string;
}

/** Adapts a provider transport to the frozen v0.3 generation lifecycle. */
export class AdapterBackedGenerationModel implements ImageGenerationRoute {
  private readonly now: () => string;

  constructor(private readonly options: AdapterBackedGenerationModelOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get descriptor(): ImageGenerationRouteDto {
    const descriptor =
      typeof this.options.descriptor === 'function' ? this.options.descriptor() : this.options.descriptor;
    return effectiveImageGenerationRouteDescriptor(descriptor, this.options.adapter);
  }

  async prepareExecution(runId: string, input: GenerationInput) {
    const route = this.descriptor;
    if (input.modelKey !== route.key) {
      throw new GenerationAdapterError({
        code: 'INVALID_REQUEST',
        message: `Input modelKey ${input.modelKey} does not match ${route.key}`,
        details: { actual: input.modelKey, expected: route.key },
      });
    }
    const request = await this.options.createRequest({ runId, input, route });
    if (request.runId !== runId) {
      throw new GenerationAdapterError({
        code: 'INVALID_REQUEST',
        message: `Request runId ${request.runId} does not match ${runId}`,
        details: { actual: request.runId, expected: runId },
      });
    }
    validateGenerationAdapterRequest(route, this.options.adapter, request);
    return {
      requestSnapshot: {
        route: 'PROVIDER_ADAPTER' as const,
        requestSchema: 'normalized-generation-request.v1',
        actualRequest: request,
        clientRequestText: request.prompt,
      },
      execute: (onStarted: GenerationStarted, onSignal?: GenerationExecutionObserver) =>
        this.executePrepared(runId, request, onStarted, onSignal),
      ...(this.options.cleanup ? { cleanup: () => this.options.cleanup?.(request) } : {}),
    };
  }

  private async executePrepared(
    runId: string,
    request: NormalizedGenerationRequest,
    onStarted: GenerationStarted,
    onSignal?: GenerationExecutionObserver,
  ): Promise<GenerationAdapterResult> {
    const abortController = new AbortController();
    try {
      onStarted(() => abortController.abort());
      this.emit({ type: 'STARTED', runId, timestamp: this.now() });
      if (abortController.signal.aborted) {
        throw new DOMException('Generation was cancelled', 'AbortError');
      }

      const adapterResult = await this.options.adapter.execute(request, {
        signal: abortController.signal,
        emit: (signal) => {
          this.emitSignal(runId, signal);
          // This observer persists provider acceptance/checkpoints and is part
          // of the durable execution contract. A storage failure must stop the
          // local run instead of losing the only remote request identifier and
          // silently risking a duplicate paid submission after restart.
          try {
            onSignal?.(signal);
          } catch (cause) {
            abortController.abort();
            throw new GenerationAdapterError({
              code: 'LOCAL_STATE',
              message: 'Failed to persist generation lifecycle state',
              retryable: false,
              details: { signalType: signal.type },
              cause,
            });
          }
        },
      });
      if (abortController.signal.aborted) {
        throw new DOMException('Generation was cancelled', 'AbortError');
      }
      const result = validateGenerationAdapterResult(adapterResult);
      this.emit({ type: 'COMPLETED', runId, timestamp: this.now(), result });
      return result;
    } catch (rawError) {
      const error = normalizeGenerationAdapterError(rawError, abortController.signal.aborted);
      this.emit({
        type: 'FAILED',
        runId,
        timestamp: this.now(),
        error: serializeGenerationAdapterError(error),
      });
      throw error;
    }
  }

  private emitSignal(runId: string, signal: GenerationAdapterSignal) {
    const timestamp = this.now();
    switch (signal.type) {
      case 'REQUEST_ACCEPTED':
        this.emit({ ...signal, runId, timestamp });
        break;
      case 'PROGRESS':
        this.emit({ ...signal, runId, timestamp });
        break;
      case 'WARNING':
        this.emit({ ...signal, runId, timestamp });
        break;
    }
  }

  private emit(event: GenerationAdapterEvent) {
    try {
      this.options.onEvent?.(event);
    } catch {
      // Observability must never change the outcome of a generation request.
    }
  }
}
