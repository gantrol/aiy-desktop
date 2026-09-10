import type { CreatorPromptNodeInput } from '@/shared/contracts';
import { blockDocumentSchema, type BlockDocument } from '@/shared/contracts/block-document';
import { creationDraftDtoSchema } from '@/shared/contracts/creation-draft';
import { z } from 'zod';

const nodesSchema = creationDraftDtoSchema.shape.promptNodes.unwrap();
const structuredSchema = z
  .object({ schemaVersion: z.literal(2), document: blockDocumentSchema, promptNodes: nodesSchema })
  .strict();

/** A versioned envelope reuses the draft's existing JSON storage, without rewriting old drafts. */
export function readCreationPromptStorage(value: string): {
  document?: BlockDocument;
  promptNodes: CreatorPromptNodeInput[];
} {
  const parsed: unknown = JSON.parse(value || '[]');
  if (Array.isArray(parsed)) return { promptNodes: nodesSchema.parse(parsed) };
  const { document, promptNodes } = structuredSchema.parse(parsed);
  return { document, promptNodes };
}

export function writeCreationPromptStorage(input: {
  document?: BlockDocument;
  promptNodes?: CreatorPromptNodeInput[];
}) {
  return JSON.stringify(
    input.document
      ? structuredSchema.parse({ schemaVersion: 2, document: input.document, promptNodes: input.promptNodes ?? [] })
      : nodesSchema.parse(input.promptNodes ?? []),
  );
}
