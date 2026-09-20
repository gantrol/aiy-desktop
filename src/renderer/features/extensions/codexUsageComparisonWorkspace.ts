import { z } from 'zod';
import {
  codexModelComparisonDistributionsSchema,
  codexModelComparisonRowSchema,
} from '@/shared/contracts/codex-model-comparison';
import type { CodexModelComparisonRow } from '@/shared/contracts/codex-model-comparison';
import type { CodexUsageInvestigation } from '@/shared/contracts/codex-usage';
import { parseEvidenceThreshold } from '@/shared/codex-usage-evidence';
import { readCodexModelComparisonPreferences } from '@/renderer/features/extensions/codexModelComparisonPreferences';

const CURRENT_KEY = 'aiy:codex-usage:comparison-workspace:v1';
const PLANS_KEY = 'aiy:codex-usage:comparison-plans:v1';
const MAX_STORAGE_LENGTH = 200_000;
const selectionSchema = z.object({
  models: z.array(codexModelComparisonRowSchema.shape.model).max(1_000).nullable(),
  modes: z.array(codexModelComparisonRowSchema.shape.serviceTier).max(3).nullable(),
  efforts: z.array(codexModelComparisonRowSchema.shape.reasoningEffort).max(1_000).nullable(),
});
export const codexComparisonWorkspaceSchema = z.object({
  selection: z.tuple([selectionSchema.nullable(), selectionSchema.nullable()]),
  metric: codexModelComparisonDistributionsSchema.keyof(),
  view: z.enum(['points', 'cumulative', 'quantiles']),
  threshold: z.string().max(80),
});
const plansSchema = z
  .array(z.object({ name: z.string().trim().min(1).max(96), settings: codexComparisonWorkspaceSchema }))
  .max(12);
export type CodexComparisonWorkspace = z.infer<typeof codexComparisonWorkspaceSchema>;
export type CodexComparisonPlan = z.infer<typeof plansSchema>[number];

function readStored(key: string): unknown {
  const value = globalThis.localStorage?.getItem(key);
  if (value && value.length > MAX_STORAGE_LENGTH) throw new Error('Comparison storage exceeds the size limit');
  return value ? JSON.parse(value) : null;
}

export function readComparisonWorkspace(): CodexComparisonWorkspace {
  try {
    const parsed = codexComparisonWorkspaceSchema.safeParse(readStored(CURRENT_KEY));
    if (parsed.success) return parsed.data;
  } catch {
    /* Continue with the legacy selection when storage is unavailable. */
  }
  return { ...readCodexModelComparisonPreferences(), view: 'points', threshold: '' };
}

export function saveComparisonWorkspace(settings: CodexComparisonWorkspace) {
  try {
    const serialized = JSON.stringify(settings);
    if (serialized.length <= MAX_STORAGE_LENGTH) globalThis.localStorage?.setItem(CURRENT_KEY, serialized);
  } catch {
    /* In-memory controls remain usable without persistence. */
  }
}

export function readComparisonPlans(): CodexComparisonPlan[] {
  try {
    const parsed = plansSchema.safeParse(readStored(PLANS_KEY));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function saveNamedComparison(name: string, settings: CodexComparisonWorkspace) {
  try {
    // Re-read on explicit writes so another window's newly saved plans are retained.
    const raw = readStored(PLANS_KEY);
    const parsed = plansSchema.safeParse(raw ?? []);
    if (!parsed.success || !globalThis.localStorage) return { status: 'unavailable' } as const;
    const plans = parsed.data;
    const trimmed = name.trim();
    const index = plans.findIndex((plan) => plan.name === trimmed);
    if (index < 0 && plans.length >= 12) return { status: 'limit' } as const;
    const next = { name: trimmed, settings };
    if (index < 0) plans.push(next);
    else plans[index] = next;
    const valid = plansSchema.safeParse(plans);
    if (!valid.success) return { status: 'unavailable' } as const;
    const serialized = JSON.stringify(valid.data);
    if (serialized.length > MAX_STORAGE_LENGTH) return { status: 'unavailable' } as const;
    globalThis.localStorage.setItem(PLANS_KEY, serialized);
    return { status: 'saved', plans: valid.data } as const;
  } catch {
    return { status: 'unavailable' } as const;
  }
}

/** Deliberate allow-list: never serialize the investigation's source paths or prompts. */
export function freezeCodexComparison(
  report: CodexUsageInvestigation,
  settings: CodexComparisonWorkspace,
  groups: readonly [readonly CodexModelComparisonRow[], readonly CodexModelComparisonRow[]],
  displayTimeZone: string,
) {
  return {
    schemaVersion: 1,
    method: 'DESCRIPTIVE_RETAINED_COMPLETED_TURNS',
    report: {
      id: report.investigationId,
      generatedAt: report.generatedAt,
      from: report.from,
      to: report.to,
      timeZone: report.timeZone,
      displayTimeZone,
      pricing: report.pricing,
      samplesTruncated: report.modelComparison?.samplesTruncated ?? true,
      algorithmVersion: report.modelComparison?.algorithmVersion ?? null,
      excludedModelTurnCount: report.modelComparison?.excludedModelTurnCount ?? null,
    },
    settings,
    thresholdInNativeUnits: parseEvidenceThreshold(settings.threshold, settings.metric),
    limitations: [
      'NOT_A_BILL_OR_QUALITY_SCORE',
      'UNMATCHED_OBSERVATIONS_NOT_CAUSAL',
      'FAILED_AND_CANCELLED_TURNS_NOT_IN_DISTRIBUTION',
      'WITHIN_SESSION_DEPENDENCE_NOT_ESTIMATED',
      'SOURCE_EVENT_IDS_AND_PER_REQUEST_PRICING_NOT_RETAINED',
      'NULL_IS_MISSING_NOT_ZERO',
    ],
    sides: groups.map((rows, index) => ({
      side: index === 0 ? 'A' : 'B',
      columns: [
        'completedAtMs',
        'durationMs',
        'requests',
        'totalTokens',
        'outputTokens',
        'apiEquivalentUsd',
        'codexCredits',
      ],
      groups: rows.map((row) => ({
        model: row.model,
        reasoningEffort: row.reasoningEffort,
        serviceTier: row.serviceTier,
        eligibleTurns: row.completedTurnCount,
        sessions: row.sessionCount,
        samples: row.samples,
      })),
    })),
  };
}

export function downloadCodexComparison(value: ReturnType<typeof freezeCodexComparison>) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = 'codex-comparison.json';
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}
