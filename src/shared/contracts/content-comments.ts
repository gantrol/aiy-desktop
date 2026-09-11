import { z } from 'zod';

const id = z.string().min(1).max(200);
const elementFingerprint = z.string().regex(/^[a-f0-9]{16}$/u);

export const contentElementNodeTypeSchema = z.enum([
  'paragraph',
  'heading',
  'listItem',
  'taskItem',
  'blockquote',
  'codeBlock',
  'image',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
]);

export const contentElementPlacementSchema = z
  .object({
    elementId: id,
    blockIndex: z.number().int().nonnegative().max(100_000),
    nodeType: contentElementNodeTypeSchema,
    textFingerprint: elementFingerprint,
    preview: z.string().max(280),
  })
  .strict();

export const contentCommentAnchorSchema = z
  .object({
    kind: z.enum(['TEXT_RANGE', 'BLOCK', 'TABLE', 'TABLE_ROW', 'TABLE_CELL']),
    startElementId: id,
    startOffset: z.number().int().nonnegative().max(1_000_000),
    endElementId: id,
    endOffset: z.number().int().nonnegative().max(1_000_000),
    startBlockIndex: z.number().int().nonnegative().max(100_000),
    endBlockIndex: z.number().int().nonnegative().max(100_000),
    exactQuote: z.string().max(2_000),
    prefix: z.string().max(200),
    suffix: z.string().max(200),
  })
  .strict();

export const contentCommentAnchorUpdateSchema = z
  .object({ commentId: id, anchor: contentCommentAnchorSchema })
  .strict();

export const contentCommentReplySchema = z
  .object({
    id,
    commentId: id,
    body: z.string().max(10_000),
    authorId: id.nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();

export const contentCommentModelAuthorSchema = z.object({ providerKey: id, modelId: id }).strict();

export const contentCommentSchema = z
  .object({
    id,
    createdRevisionId: id,
    status: z.enum(['OPEN', 'RESOLVED', 'REJECTED']),
    targetResolution: z.enum(['AVAILABLE', 'RELOCATED', 'MISSING']),
    anchor: contentCommentAnchorSchema,
    preview: z.string().max(280),
    body: z.string().max(10_000),
    authorId: id.nullable(),
    modelAuthor: contentCommentModelAuthorSchema.nullable(),
    replies: z.array(contentCommentReplySchema).max(2_000),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
    resolvedAt: z.string().min(1).nullable(),
  })
  .strict();

export type ContentElementNodeType = z.infer<typeof contentElementNodeTypeSchema>;
export type ContentElementPlacementInput = z.infer<typeof contentElementPlacementSchema>;
export type ContentCommentAnchorInput = z.infer<typeof contentCommentAnchorSchema>;
export type ContentCommentAnchorUpdateInput = z.infer<typeof contentCommentAnchorUpdateSchema>;
export type ContentCommentReplyDto = z.infer<typeof contentCommentReplySchema>;
export type ContentCommentModelAuthor = z.infer<typeof contentCommentModelAuthorSchema>;
export type ContentCommentDto = z.infer<typeof contentCommentSchema>;
export type ContentCommentStatus = ContentCommentDto['status'];
