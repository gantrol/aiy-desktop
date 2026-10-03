import { z } from 'zod';

const count = z.number().int().nonnegative().safe();

export const codexOutputThroughputSchema = z
  .object({
    outputTokens: count,
    durationMs: count,
    pairedTurnCount: count,
    completedTurnCount: count,
    abortedTurnCount: count,
    missingUsageTurnCount: count,
    invalidDurationTurnCount: count,
    partial: z.boolean(),
  })
  .strict();

export const codexOutputThroughputGroupSchema = z
  .object({
    model: z.string().nullable(),
    reasoningEffort: z.string().nullable(),
    serviceTier: z.enum(['STANDARD', 'FAST', 'UNKNOWN']),
    throughput: codexOutputThroughputSchema,
  })
  .strict();

export const codexOutputThroughputAnalysisSchema = z
  .object({
    overall: codexOutputThroughputSchema,
    groups: z.array(codexOutputThroughputGroupSchema).max(1_000),
    truncated: z.boolean(),
  })
  .strict();

export type CodexOutputThroughput = z.infer<typeof codexOutputThroughputSchema>;
export type CodexOutputThroughputGroup = z.infer<typeof codexOutputThroughputGroupSchema>;
export type CodexOutputThroughputAnalysis = z.infer<typeof codexOutputThroughputAnalysisSchema>;
