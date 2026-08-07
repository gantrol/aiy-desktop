/**
 * L1 business stub: a scriptable `GenerationAdapter`.
 *
 * `GenerationAdapter` is already the provider-neutral boundary, so the
 * coordinator, persistence, retry, and cancellation paths can be exercised in
 * full without a provider, a socket, or a byte of HTTP. Use this for everything
 * except wire-format questions; use the stub server for those.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  GenerationAdapter,
  GenerationAdapterExecutionContext,
  GenerationAdapterResult,
  GenerationAdapterSignal,
  NormalizedGenerationRequest,
} from '../../src/main/generation-models/adapters/contracts';
import {
  GenerationAdapterError,
  type GenerationAdapterErrorCode,
} from '../../src/main/generation-models/adapters/errors';
import type { GenerationModelCapability } from '../../src/shared/contracts';
import { readFixture } from './fixtures';

export type FakeAdapterStep =
  /** Writes a real PNG to the run directory and resolves with a FILE result. */
  | {
      kind: 'ok';
      imageFixture?: string;
      signals?: GenerationAdapterSignal[];
      responseMetadata?: Record<string, unknown>;
      providerRequestId?: string;
      revisedPrompt?: string;
      delayMs?: number;
    }
  /** Resolves with a LIBRARY_ASSET result, as the internal model does. */
  | { kind: 'library-asset'; sourceAssetId: string; relationType?: string }
  /** Rejects with a typed adapter error; `retryable` defaults to the code's policy. */
  | {
      kind: 'error';
      code: GenerationAdapterErrorCode;
      message?: string;
      providerCode?: string;
      retryable?: boolean;
      signalsBefore?: GenerationAdapterSignal[];
    }
  /** Never settles until the abort signal fires. Drives cancel and restart tests. */
  | { kind: 'hang' };

export interface FakeGenerationAdapterOptions {
  providerKey?: string;
  capabilities?: readonly GenerationModelCapability[];
  maxReferenceImages?: number | null;
  /** Mirrors the real adapters, which reject bad requests before any I/O. */
  validate?(request: NormalizedGenerationRequest): void;
}

const defaultCapabilities = [
  'GENERATE',
  'REFERENCE_IMAGE',
  'MULTI_REFERENCE',
  'IMAGE_EDIT',
  'MASK_EDIT',
] as const satisfies readonly GenerationModelCapability[];

export class FakeGenerationAdapter implements GenerationAdapter {
  readonly providerKey: string;
  readonly capabilities: readonly GenerationModelCapability[];
  readonly maxReferenceImages: number | null;

  /** Every request the coordinator handed over, in order. */
  readonly requests: NormalizedGenerationRequest[] = [];
  /** Every signal emitted per run id, for asserting progress-stage ordering. */
  readonly signals = new Map<string, GenerationAdapterSignal[]>();

  private callIndex = 0;

  constructor(
    private readonly steps: FakeAdapterStep[],
    private readonly libraryRoot: string,
    private readonly options: FakeGenerationAdapterOptions = {},
  ) {
    this.providerKey = options.providerKey ?? 'fake';
    this.capabilities = options.capabilities ?? defaultCapabilities;
    this.maxReferenceImages = options.maxReferenceImages ?? 8;
  }

  get callCount() {
    return this.callIndex;
  }

  validateRequest(request: NormalizedGenerationRequest) {
    this.options.validate?.(request);
  }

  async execute(
    request: NormalizedGenerationRequest,
    context: GenerationAdapterExecutionContext,
  ): Promise<GenerationAdapterResult> {
    this.requests.push(request);
    const step = this.steps[Math.min(this.callIndex, this.steps.length - 1)] ?? {
      kind: 'error' as const,
      code: 'UNKNOWN' as const,
      message: 'FakeGenerationAdapter has no scripted step',
    };
    this.callIndex += 1;

    const emit = (signal: GenerationAdapterSignal) => {
      const recorded = this.signals.get(request.runId) ?? [];
      recorded.push(signal);
      this.signals.set(request.runId, recorded);
      context.emit(signal);
    };

    if (step.kind === 'hang') {
      return new Promise<never>((_resolve, reject) => {
        if (context.signal.aborted) {
          reject(new GenerationAdapterError({ code: 'CANCELLED', message: 'Generation was cancelled' }));
          return;
        }
        context.signal.addEventListener(
          'abort',
          () => {
            reject(new GenerationAdapterError({ code: 'CANCELLED', message: 'Generation was cancelled' }));
          },
          { once: true },
        );
      });
    }

    if (step.kind === 'error') {
      for (const signal of step.signalsBefore ?? []) emit(signal);
      throw new GenerationAdapterError({
        code: step.code,
        message: step.message ?? `Fake adapter failure: ${step.code}`,
        ...(step.providerCode ? { providerCode: step.providerCode } : {}),
        ...(step.retryable === undefined ? {} : { retryable: step.retryable }),
      });
    }

    if (step.kind === 'library-asset') {
      emit({ type: 'REQUEST_ACCEPTED' });
      return {
        kind: 'LIBRARY_ASSET',
        sourceAssetId: step.sourceAssetId,
        ...(step.relationType ? { relationType: step.relationType } : {}),
      };
    }

    emit({
      type: 'REQUEST_ACCEPTED',
      ...(step.providerRequestId ? { providerRequestId: step.providerRequestId } : {}),
    });
    for (const signal of step.signals ?? [{ type: 'PROGRESS' as const, stage: 'GENERATING' as const }]) emit(signal);
    if (step.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs));

    const outputPath = this.outputPath(request.runId);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, readFixture(`images/${step.imageFixture ?? 'valid-64x64.png'}`));

    return {
      kind: 'FILE',
      outputPath,
      mimeType: 'image/png',
      ...(step.providerRequestId ? { providerRequestId: step.providerRequestId } : {}),
      responseMetadata: {
        quality: request.output.quality,
        size:
          request.output.width && request.output.height ? `${request.output.width}x${request.output.height}` : 'auto',
        ...step.responseMetadata,
      },
      ...(step.revisedPrompt
        ? { providerReturnedDescriptions: [{ fieldName: 'revised_prompt', rawValue: step.revisedPrompt }] }
        : {}),
    };
  }

  cleanup() {
    // The real adapters remove their run directory here. Tests that assert
    // temp-artifact recovery deliberately keep it, so this is a no-op.
  }

  private outputPath(runId: string) {
    return path.resolve(this.libraryRoot, 'temp', 'fake-provider', runId, 'result.png');
  }
}
