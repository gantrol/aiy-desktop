import { z } from 'zod';
import { contentCommentSchema, type ContentCommentDto } from '@/shared/contracts/content-comments';

export type { CommentCompilationResult } from '@/shared/contracts/comment-compilation-result';

export const COMMENT_COMPILATION_LIMIT = 50;
export const COMMENT_COMPILATION_TEXT_LIMIT = 200_000;
const id = z.string().min(1).max(200);

/** Expectations only: the host copies persisted comments, never caller-supplied replacements. */
export const commentCompilationSelectionSchema = contentCommentSchema
  .pick({
    id: true,
    createdRevisionId: true,
    anchor: true,
    body: true,
    authorId: true,
    modelAuthor: true,
    updatedAt: true,
  })
  .strict();
export type CommentCompilationSelection = z.infer<typeof commentCompilationSelectionSchema>;

export function commentCompilationSelection(comment: ContentCommentDto): CommentCompilationSelection {
  return commentCompilationSelectionSchema.parse({
    id: comment.id,
    createdRevisionId: comment.createdRevisionId,
    anchor: comment.anchor,
    body: comment.body,
    authorId: comment.authorId,
    modelAuthor: comment.modelAuthor,
    updatedAt: comment.updatedAt,
  });
}

export const commentCompilationInputSchema = z
  .object({
    spaceId: id,
    requestId: z.string().uuid(),
    sourceArticleId: id,
    expectedRevisionId: id,
    title: z.string().trim().min(1).max(200),
    format: z.enum(['MANUSCRIPT', 'OUTLINE']),
    includeQuotes: z.boolean(),
    comments: z.array(commentCompilationSelectionSchema).min(1).max(COMMENT_COMPILATION_LIMIT),
  })
  .strict()
  .superRefine((input, context) => {
    if (new Set(input.comments.map((comment) => comment.id)).size !== input.comments.length)
      context.addIssue({ code: 'custom', path: ['comments'], message: 'COMMENT_COMPILATION_DUPLICATE' });
    const textLength = input.comments.reduce(
      (total, comment) => total + comment.body.length + (input.includeQuotes ? comment.anchor.exactQuote.length : 0),
      0,
    );
    const lines = input.comments.reduce(
      (total, comment) =>
        total +
        comment.body.split(/\r\n|\r|\n/u).length +
        (input.includeQuotes ? comment.anchor.exactQuote.split(/\r\n|\r|\n/u).length : 0),
      0,
    );
    if (textLength > COMMENT_COMPILATION_TEXT_LIMIT || lines > 5_000)
      context.addIssue({ code: 'custom', path: ['comments'], message: 'COMMENT_COMPILATION_TOO_LARGE' });
    if (
      input.comments.some(
        (comment) => !comment.body.trim() && !(input.includeQuotes && comment.anchor.exactQuote.trim()),
      )
    )
      context.addIssue({ code: 'custom', path: ['comments'], message: 'COMMENT_COMPILATION_EMPTY' });
  });
export type CommentCompilationInput = z.infer<typeof commentCompilationInputSchema>;

/** Block identities refer to the new article's immutable first revision, not its later edits. */
export const commentCompilationOriginSchema = z
  .object({
    sourceArticleId: id,
    sourceRevisionId: id,
    compiledRevisionNo: z.literal(1),
    comments: z
      .array(
        z
          .object({
            commentId: id,
            createdRevisionId: id,
            createdAt: z.string().min(1),
            updatedAt: z.string().min(1),
            sourceElementId: id,
            bodyBlockIds: z.array(id).min(1).max(5_000),
            quoteBlockIds: z.array(id).min(1).max(5_000).optional(),
            authorId: id.nullable(),
            authorName: z.string().max(200).nullable(),
            modelAuthor: contentCommentSchema.shape.modelAuthor,
          })
          .strict(),
      )
      .min(1)
      .max(COMMENT_COMPILATION_LIMIT),
  })
  .strict();
export type CommentCompilationOrigin = z.infer<typeof commentCompilationOriginSchema>;
