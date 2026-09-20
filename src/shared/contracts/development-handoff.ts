import { z } from 'zod';

const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u);
const text = z
  .string()
  .max(8_000)
  .refine((value) => /\S/u.test(value), 'Text must not be blank');
const repositoryUrl = z
  .url()
  .max(2_000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
    } catch {
      return false;
    }
  }, 'Use an HTTPS repository URL without credentials, query or fragment');
export const handoffSourceSchema = z
  .object({
    id: identifier,
    kind: z.enum(['requirement', 'observation', 'research', 'decision', 'verification']),
    title: z.string().min(1).max(300),
    locator: z.string().max(2_000).optional(),
    revision: z.string().max(200).optional(),
    status: z.enum(['unreviewed', 'selected', 'superseded']).default('unreviewed'),
    content: z.string().min(1).max(100_000),
  })
  .strict();

/** Supplied snapshots are context, not proof of remote state or permission to execute. */
export const developmentHandoffInputSchema = z
  .object({
    protocolVersion: z.literal(1),
    taskId: identifier,
    phase: z.enum(['expression', 'trial', 'confirmation', 'development', 'acceptance', 'maintenance']),
    objective: text,
    repository: z
      .object({
        url: repositoryUrl,
        baseCommit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u),
      })
      .strict()
      .optional(),
    constraints: z.array(text).max(30).default([]),
    outOfScope: z.array(text).max(30).default([]),
    questions: z.array(text).max(30).default([]),
    sources: z.array(handoffSourceSchema).max(24).default([]),
    acceptance: z
      .array(
        z
          .object({
            id: identifier,
            expectation: text,
            sourceIds: z.array(identifier).max(24).default([]),
          })
          .strict(),
      )
      .max(30)
      .default([]),
  })
  .strict();
export type DevelopmentHandoffInput = z.infer<typeof developmentHandoffInputSchema>;
export const developmentHandoffPacketSchema = z
  .object({
    format: z.literal('aiy-development-handoff'),
    schemaVersion: z.literal(1),
    input: developmentHandoffInputSchema,
    sourceDigests: z.array(z.object({ id: identifier, sha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()).max(24),
    digest: z.string().regex(/^[a-f0-9]{64}$/u),
    brief: z.string().max(1_000_000),
  })
  .strict();
export type DevelopmentHandoffPacket = z.infer<typeof developmentHandoffPacketSchema>;
