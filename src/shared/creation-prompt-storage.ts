import type { CreatorPromptNodeInput } from '@/shared/contracts';
import { blockDocumentSchema, type BlockDocument } from '@/shared/contracts/block-document';
import {
  creationDraftDtoSchema,
  creationStartModeSchema,
  type CreationStartMode,
} from '@/shared/contracts/creation-draft';
import { z } from 'zod';
import { creationSourceSchema, type CreationSource } from '@/shared/contracts/creation-source';

const nodesSchema = creationDraftDtoSchema.shape.promptNodes.unwrap();
const structuredSchema = z
  .object({ schemaVersion: z.literal(2), document: blockDocumentSchema, promptNodes: nodesSchema })
  .strict();
const workspaceSchema = z
  .object({
    schemaVersion: z.literal(3),
    document: blockDocumentSchema.optional(),
    promptNodes: nodesSchema,
    startMode: creationStartModeSchema,
    writingInstruction: z.string().max(8_000).optional(),
    creationSource: creationSourceSchema.optional(),
  })
  .strict();

/** A versioned envelope reuses the draft's existing JSON storage, without rewriting old drafts. */
export function readCreationPromptStorage(value: string): {
  document?: BlockDocument;
  startMode?: CreationStartMode;
  writingInstruction?: string;
  creationSource?: CreationSource;
  promptNodes: CreatorPromptNodeInput[];
} {
  const parsed: unknown = JSON.parse(value || '[]');
  if (Array.isArray(parsed)) return { promptNodes: nodesSchema.parse(parsed) };
  const { schemaVersion: _version, ...snapshot } = z.union([structuredSchema, workspaceSchema]).parse(parsed);
  return snapshot;
}

export function writeCreationPromptStorage(input: {
  creationSource?: CreationSource;
  writingInstruction?: string;
  document?: BlockDocument;
  startMode?: CreationStartMode;
  promptNodes?: CreatorPromptNodeInput[];
}) {
  if (input.startMode || input.writingInstruction !== undefined || input.creationSource)
    return JSON.stringify(
      workspaceSchema.parse({
        schemaVersion: 3,
        document: input.document,
        promptNodes: input.promptNodes ?? [],
        startMode: input.startMode ?? 'image',
        writingInstruction: input.writingInstruction,
        creationSource: input.creationSource,
      }),
    );
  return JSON.stringify(
    input.document
      ? structuredSchema.parse({ schemaVersion: 2, document: input.document, promptNodes: input.promptNodes ?? [] })
      : nodesSchema.parse(input.promptNodes ?? []),
  );
}
