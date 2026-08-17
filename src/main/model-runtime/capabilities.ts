import {
  modelRuntimeCapabilitiesSchema,
  type ModelRuntimeCapabilities,
  type ModelRuntimeInputManifest,
  type ModelRuntimeTaskRequirement,
} from '@/main/model-runtime/contracts';

export type ModelRuntimeCapabilityDimension =
  | 'INPUT_MODALITY'
  | 'OUTPUT_KIND'
  | 'STRUCTURED_OUTPUT_MODE'
  | 'EXECUTION_MODE'
  | 'TOOL_MODE'
  | 'STREAM_MODE'
  | 'TRANSCRIPTION_TIMESTAMP'
  | 'SPEAKER_IDENTIFICATION';

export interface ModelRuntimeCapabilityMismatch {
  dimension: ModelRuntimeCapabilityDimension;
  required: string;
}

function intersectValues<T extends string>(values: readonly (readonly T[])[]) {
  const [first, ...rest] = values;
  if (!first) return [];
  return [...new Set(first)].filter((value) => rest.every((candidate) => candidate.includes(value)));
}

export function intersectModelRuntimeCapabilities(
  capabilities: readonly ModelRuntimeCapabilities[],
): ModelRuntimeCapabilities {
  if (capabilities.length === 0) {
    return modelRuntimeCapabilitiesSchema.parse({
      inputModalities: [],
      outputKinds: [],
      structuredOutputModes: [],
      executionModes: [],
      toolModes: [],
      streamModes: [],
      transcriptionTimestamps: [],
      speakerIdentification: [],
      returnedFacts: [],
    });
  }

  return modelRuntimeCapabilitiesSchema.parse({
    inputModalities: intersectValues(capabilities.map((entry) => entry.inputModalities)),
    outputKinds: intersectValues(capabilities.map((entry) => entry.outputKinds)),
    structuredOutputModes: intersectValues(capabilities.map((entry) => entry.structuredOutputModes)),
    executionModes: intersectValues(capabilities.map((entry) => entry.executionModes)),
    toolModes: intersectValues(capabilities.map((entry) => entry.toolModes)),
    streamModes: intersectValues(capabilities.map((entry) => entry.streamModes)),
    transcriptionTimestamps: intersectValues(capabilities.map((entry) => entry.transcriptionTimestamps)),
    speakerIdentification: intersectValues(capabilities.map((entry) => entry.speakerIdentification)),
    returnedFacts: intersectValues(capabilities.map((entry) => entry.returnedFacts)),
  });
}

export function modelRuntimeCapabilityMismatches(
  capabilities: ModelRuntimeCapabilities,
  requirement: ModelRuntimeTaskRequirement,
): ModelRuntimeCapabilityMismatch[] {
  const mismatches: ModelRuntimeCapabilityMismatch[] = [];
  for (const modality of requirement.requiredInputModalities) {
    if (!capabilities.inputModalities.includes(modality)) {
      mismatches.push({ dimension: 'INPUT_MODALITY', required: modality });
    }
  }
  if (!capabilities.outputKinds.includes(requirement.outputKind)) {
    mismatches.push({ dimension: 'OUTPUT_KIND', required: requirement.outputKind });
  }
  if (!capabilities.structuredOutputModes.includes(requirement.structuredOutputMode)) {
    mismatches.push({ dimension: 'STRUCTURED_OUTPUT_MODE', required: requirement.structuredOutputMode });
  }
  if (!capabilities.executionModes.includes(requirement.executionMode)) {
    mismatches.push({ dimension: 'EXECUTION_MODE', required: requirement.executionMode });
  }
  if (!capabilities.toolModes.includes(requirement.toolMode)) {
    mismatches.push({ dimension: 'TOOL_MODE', required: requirement.toolMode });
  }
  if (!capabilities.streamModes.includes(requirement.streamMode)) {
    mismatches.push({ dimension: 'STREAM_MODE', required: requirement.streamMode });
  }
  if (!capabilities.transcriptionTimestamps.includes(requirement.transcriptionTimestamp)) {
    mismatches.push({ dimension: 'TRANSCRIPTION_TIMESTAMP', required: requirement.transcriptionTimestamp });
  }
  if (!capabilities.speakerIdentification.includes(requirement.speakerIdentification)) {
    mismatches.push({ dimension: 'SPEAKER_IDENTIFICATION', required: requirement.speakerIdentification });
  }
  return mismatches;
}

export function modelRuntimeInputMismatches(
  capabilities: ModelRuntimeCapabilities,
  requirement: ModelRuntimeTaskRequirement,
  manifest: ModelRuntimeInputManifest,
): ModelRuntimeCapabilityMismatch[] {
  const mismatches = modelRuntimeCapabilityMismatches(capabilities, requirement);
  for (const modality of manifest.submittedInputModalities) {
    if (!capabilities.inputModalities.includes(modality)) {
      mismatches.push({ dimension: 'INPUT_MODALITY', required: modality });
    }
  }
  for (const modality of requirement.requiredInputModalities) {
    if (!manifest.submittedInputModalities.includes(modality)) {
      mismatches.push({ dimension: 'INPUT_MODALITY', required: modality });
    }
  }
  return mismatches.filter(
    (mismatch, index, all) =>
      all.findIndex(
        (candidate) => candidate.dimension === mismatch.dimension && candidate.required === mismatch.required,
      ) === index,
  );
}

export function modelRuntimeCapabilitiesCover(
  capabilities: ModelRuntimeCapabilities,
  requirement: ModelRuntimeTaskRequirement,
) {
  return modelRuntimeCapabilityMismatches(capabilities, requirement).length === 0;
}
