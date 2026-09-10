import { z } from 'zod';
import { derivedVisualAdoptInputSchema } from '@/shared/contracts/derived-visual';
import type { ArticleRevisionDto } from '@/shared/contracts/article';
import type { SocialPostDto } from '@/shared/contracts';

const id = z.string().min(1).max(200);
export const derivedVisualUndoInputSchema = z
  .object({
    id,
    requestId: id,
    spaceId: id,
    adoptionRequestId: id,
    expectedRevisionId: id,
  })
  .strict();
export const derivedVisualOperationRequestSchema = z.discriminatedUnion('kind', [
  derivedVisualAdoptInputSchema.extend({ kind: z.literal('ADOPT') }),
  derivedVisualUndoInputSchema.extend({ kind: z.literal('UNDO') }),
]);
export const derivedVisualOperationIdentitySchema = z.object({ spaceId: id, id, requestId: id }).strict();
export const derivedVisualOperationsListInputSchema = z
  .object({
    spaceId: id,
    id,
    beforeSequence: z.number().int().positive().nullable().default(null),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();
export const derivedVisualOperationSchema = z
  .object({
    sequence: z.number().int().positive(),
    request: derivedVisualOperationRequestSchema,
    status: z.enum(['PENDING', 'SUCCEEDED', 'CONFLICT', 'CANCELLED']),
    target: z.object({ kind: z.enum(['ARTICLE', 'SOCIAL_POST']), id }).strict(),
    beforeRevisionId: id,
    resultRevisionId: id.nullable(),
    observedRevisionId: id.nullable(),
    conflictReason: z.enum(['TARGET_CHANGED', 'VISUAL_CHANGED', 'ALREADY_UNDONE']).nullable(),
    undoneByRequestId: id.nullable(),
    createdAt: z.string(),
    finishedAt: z.string().nullable(),
  })
  .strict();
export type DerivedVisualUndoInput = z.infer<typeof derivedVisualUndoInputSchema>;
export type DerivedVisualOperationRequest = z.infer<typeof derivedVisualOperationRequestSchema>;
export type DerivedVisualOperationIdentity = z.infer<typeof derivedVisualOperationIdentitySchema>;
export type DerivedVisualOperationsListInput = z.infer<typeof derivedVisualOperationsListInputSchema>;
export type DerivedVisualOperationDto = z.infer<typeof derivedVisualOperationSchema>;
export interface DerivedVisualOperationsPage {
  operations: DerivedVisualOperationDto[];
  nextBeforeSequence: number | null;
}
export type DerivedVisualRevisionSnapshot =
  { kind: 'ARTICLE'; revision: ArticleRevisionDto } | { kind: 'SOCIAL_POST'; post: SocialPostDto };
export interface DerivedVisualOperationDetails {
  operation: DerivedVisualOperationDto;
  // An unavailable historical revision stays missing; it is never replaced with the current revision.
  before: DerivedVisualRevisionSnapshot | null;
  after: DerivedVisualRevisionSnapshot | null;
  observed: DerivedVisualRevisionSnapshot | null;
}
export interface DerivedVisualOperationsApi {
  derivedVisualAdopt(input: z.infer<typeof derivedVisualAdoptInputSchema>): Promise<DerivedVisualOperationDto>;
  derivedVisualUndo(input: DerivedVisualUndoInput): Promise<DerivedVisualOperationDto>;
  derivedVisualOperationGet(input: DerivedVisualOperationIdentity): Promise<DerivedVisualOperationDetails | null>;
  derivedVisualOperationsList(input: DerivedVisualOperationsListInput): Promise<DerivedVisualOperationsPage>;
  derivedVisualOperationCancel(input: DerivedVisualOperationRequest): Promise<DerivedVisualOperationDto>;
}
