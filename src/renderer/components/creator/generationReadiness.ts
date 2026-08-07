import type { ImageGenerationRouteDto } from '@/shared/contracts';

export type GenerationBlockReason =
  | 'PROMPT_EMPTY'
  | 'NO_MODEL'
  | 'MODEL_UNAVAILABLE'
  | 'MODEL_CANNOT_GENERATE'
  | 'REFERENCE_UNSUPPORTED'
  | 'MULTI_REFERENCE_UNSUPPORTED'
  | 'TOO_MANY_REFERENCES';

export interface GenerationReadiness {
  ready: boolean;
  reason: GenerationBlockReason | null;
  /** Name of the model that blocks the run, so the message can point at it. */
  modelName: string;
  /** Reference image budget of the blocking model; only meaningful for TOO_MANY_REFERENCES. */
  referenceLimit: number;
  /** Provider-supplied explanation for an unavailable model, when there is one. */
  availabilityReason: string;
}

const ready: GenerationReadiness = {
  ready: true,
  reason: null,
  modelName: '',
  referenceLimit: 0,
  availabilityReason: '',
};

function blocked(reason: GenerationBlockReason, model?: ImageGenerationRouteDto): GenerationReadiness {
  return {
    ready: false,
    reason,
    modelName: model?.name ?? '',
    referenceLimit: model?.maxReferenceImages ?? 0,
    availabilityReason: model?.availabilityReason ?? '',
  };
}

interface SharedInput {
  prompt: string;
  selectedModelKeys: string[];
  referenceCount: number;
}

type Input = SharedInput &
  (
    | { routes: ImageGenerationRouteDto[]; models?: never }
    | {
        routes?: never;
        /** @deprecated Compatibility input only. Product code uses routes. */
        models: ImageGenerationRouteDto[];
      }
  );

/**
 * Reports whether a run can start and, when it cannot, which single condition to explain first.
 * The first selected model that fails decides the message so the user always has one thing to fix.
 */
export function generationReadiness(input: Input): GenerationReadiness {
  const { prompt, selectedModelKeys, referenceCount } = input;
  const routes = input.routes ?? input.models;
  if (!prompt.trim()) return blocked('PROMPT_EMPTY');
  if (!selectedModelKeys.length) return blocked('NO_MODEL');

  for (const modelKey of selectedModelKeys) {
    const model = routes.find((item) => item.key === modelKey);
    if (!model) return blocked('MODEL_UNAVAILABLE');
    if (model.state !== 'READY') return blocked('MODEL_UNAVAILABLE', model);
    if (!model.capabilities.includes('GENERATE')) return blocked('MODEL_CANNOT_GENERATE', model);
    if (referenceCount > 0 && !model.capabilities.includes('REFERENCE_IMAGE'))
      return blocked('REFERENCE_UNSUPPORTED', model);
    if (referenceCount > 1 && !model.capabilities.includes('MULTI_REFERENCE'))
      return blocked('MULTI_REFERENCE_UNSUPPORTED', model);
    if (model.maxReferenceImages !== null && referenceCount > model.maxReferenceImages)
      return blocked('TOO_MANY_REFERENCES', model);
  }

  return ready;
}
