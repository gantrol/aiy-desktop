import type { PromptCommonInputDto, PromptInputSnapshotDto } from '@/shared/contracts';
import { blockDocumentSchema } from '@/shared/contracts/block-document';
import { createHash } from 'node:crypto';

function objectValue(value: unknown, label: string): Record<string, unknown> {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new Error(`${label} is not valid JSON`);
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function jsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  );
}

export function canonicalSnapshotJson(value: unknown) {
  return JSON.stringify(canonicalValue(jsonValue(value)));
}

export function snapshotContentHash(value: unknown) {
  return createHash('sha256').update(canonicalSnapshotJson(value)).digest('hex');
}

export function promptInputSourceKind(input: PromptCommonInputDto): PromptInputSnapshotDto['sourceKind'] {
  return input.flatPrompt === undefined ? 'COMPOSED' : 'FLAT_INPUT';
}

export function promptInputContentHash(input: PromptCommonInputDto) {
  return snapshotContentHash({
    sourceKind: promptInputSourceKind(input),
    commonInput: input,
  });
}

export function parsePromptCommonInput(value: unknown): PromptCommonInputDto {
  const input = objectValue(value, 'Prompt input snapshot');
  if (
    typeof input.userInstruction !== 'string' ||
    (input.directTermPromptLocale !== 'zh' && input.directTermPromptLocale !== 'en') ||
    !Array.isArray(input.directTerms) ||
    !Array.isArray(input.recipes) ||
    !Array.isArray(input.directReferences)
  ) {
    throw new Error('Prompt input snapshot does not satisfy the v0.3 contract');
  }
  if ('flatPrompt' in input && typeof input.flatPrompt !== 'string') {
    throw new Error('Prompt input snapshot flatPrompt must be a string');
  }
  if ('flatNegativePrompt' in input && typeof input.flatNegativePrompt !== 'string') {
    throw new Error('Prompt input snapshot flatNegativePrompt must be a string');
  }
  if ('flatResolvedPrompt' in input) {
    const resolved = objectValue(input.flatResolvedPrompt, 'Prompt input snapshot flatResolvedPrompt');
    if (typeof resolved.commonExpression !== 'string' || typeof resolved.negativeExpression !== 'string') {
      throw new Error('Prompt input snapshot flatResolvedPrompt is invalid');
    }
  }
  if ('contentNodes' in input && !Array.isArray(input.contentNodes)) {
    throw new Error('Prompt input snapshot contentNodes must be an array');
  }
  if ('document' in input) blockDocumentSchema.parse(input.document);
  return input as unknown as PromptCommonInputDto;
}
