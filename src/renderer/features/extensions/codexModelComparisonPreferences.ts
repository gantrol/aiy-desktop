import { z } from 'zod';
import {
  codexModelComparisonDistributionsSchema,
  codexModelComparisonRowSchema,
} from '@/shared/contracts/codex-model-comparison';

const PREFERENCE_KEY = 'aiy:codex-model-comparison:preferences:v1';
const selectionSchema = z.object({
  models: z.array(codexModelComparisonRowSchema.shape.model).max(1_000).nullable(),
  modes: z.array(codexModelComparisonRowSchema.shape.serviceTier).max(3).nullable(),
  efforts: z.array(codexModelComparisonRowSchema.shape.reasoningEffort).max(1_000).nullable(),
});
const preferencesSchema = z.object({
  selection: z.tuple([selectionSchema.nullable(), selectionSchema.nullable()]),
  metric: codexModelComparisonDistributionsSchema.keyof(),
});

export type CodexModelComparisonPreferences = z.infer<typeof preferencesSchema>;

export function readCodexModelComparisonPreferences(): CodexModelComparisonPreferences {
  try {
    const serialized = globalThis.localStorage?.getItem(PREFERENCE_KEY);
    if (serialized) {
      const parsed = preferencesSchema.safeParse(JSON.parse(serialized));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // Invalid or unavailable storage falls back to the initial comparison.
  }
  return { selection: [null, null], metric: 'apiEquivalentUsd' };
}

export function saveCodexModelComparisonPreferences(preferences: CodexModelComparisonPreferences) {
  try {
    globalThis.localStorage?.setItem(PREFERENCE_KEY, JSON.stringify(preferences));
  } catch {
    // Keep the current comparison usable when browser persistence is unavailable.
  }
}
