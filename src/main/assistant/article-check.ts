import { z } from 'zod';
import type { ArticleCheckInput, ArticleCheckResult } from '@/shared/contracts';
import { articleCheckResultSchema } from '@/shared/contracts/article';

const modelFindingSchema = z
  .object({
    blockIndex: z.number().int().nonnegative().max(100_000),
    startOffset: z.number().int().nonnegative().max(1_000_000),
    exactQuote: z
      .string()
      .min(1)
      .max(2_000)
      .refine((value) => Boolean(value.trim()), 'Article check quotes cannot be blank'),
    comment: z.string().trim().min(1).max(10_000),
  })
  .strict();

const modelResultSchema = z
  .object({
    issues: z.array(modelFindingSchema).max(100),
  })
  .strict();

export const articleCheckOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['blockIndex', 'startOffset', 'exactQuote', 'comment'],
        properties: {
          blockIndex: { type: 'integer', minimum: 0, maximum: 100_000 },
          startOffset: { type: 'integer', minimum: 0, maximum: 1_000_000 },
          exactQuote: { type: 'string', minLength: 1, maxLength: 2_000 },
          comment: { type: 'string', minLength: 1, maxLength: 10_000 },
        },
      },
    },
  },
} as const;

function invalidOutput(message: string) {
  return Object.assign(new Error(message), { code: 'ARTICLE_CHECK_INVALID_OUTPUT' as const });
}

function parseModelResult(message: string) {
  if (Buffer.byteLength(message, 'utf8') > 1_000_000) {
    throw invalidOutput('Codex returned an oversized article check result');
  }
  let value: unknown;
  try {
    value = JSON.parse(message) as unknown;
  } catch {
    throw invalidOutput('Codex returned malformed article check JSON');
  }
  const parsed = modelResultSchema.safeParse(value);
  if (!parsed.success) throw invalidOutput('Codex returned an invalid article check result');
  return parsed.data;
}

export function decodeArticleCheckResult(input: ArticleCheckInput, message: string): ArticleCheckResult {
  const raw = parseModelResult(message);
  const blocks = new Map(input.blocks.map((block) => [block.blockIndex, block]));
  const seen = new Set<string>();
  const findings = raw.issues.map((issue) => {
    const block = blocks.get(issue.blockIndex);
    if (!block) throw invalidOutput(`Codex targeted an unknown article block index: ${issue.blockIndex}`);
    const startOffset = issue.startOffset;
    const endOffset = startOffset + issue.exactQuote.length;
    if (block.text.slice(startOffset, endOffset) !== issue.exactQuote) {
      throw invalidOutput(`Codex returned a quote that does not match block ${issue.blockIndex} at its startOffset`);
    }
    const body = issue.comment.trim();
    const key = `${block.elementId}\u0000${startOffset}\u0000${issue.exactQuote}\u0000${body}`;
    if (seen.has(key)) throw invalidOutput('Codex returned duplicate article check findings');
    seen.add(key);
    return {
      anchor: {
        kind: 'TEXT_RANGE' as const,
        startElementId: block.elementId,
        startOffset,
        endElementId: block.elementId,
        endOffset,
        startBlockIndex: block.blockIndex,
        endBlockIndex: block.blockIndex,
        exactQuote: issue.exactQuote,
        prefix: block.text.slice(Math.max(0, startOffset - 200), startOffset),
        suffix: block.text.slice(endOffset, endOffset + 200),
      },
      preview: issue.exactQuote.replace(/\s+/gu, ' ').trim().slice(0, 280),
      body,
    };
  });
  return articleCheckResultSchema.parse({ findings });
}
