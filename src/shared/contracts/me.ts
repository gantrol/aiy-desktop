import { z } from 'zod';
import { contentLookupResultSchema } from '@/shared/contracts/content-search';
import { creationFormEntityRefSchema } from '@/shared/contracts/creation-library';
import { authorSummarySchema } from '@/shared/contracts/authorship';

// Bounded thumbnails travel with the space database, without external file paths.
export const profileAvatarSchema = z
  .string()
  .max(128_000)
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
export const userProfileSchema = z
  .object({
    /** Optional on older save requests; the space owns this immutable identity. */
    id: z.string().uuid().optional(),
    revision: z.number().int().positive().optional(),
    authorName: z.string().trim().max(200),
    avatarDataUrl: profileAvatarSchema.nullable().optional(),
  })
  .strict();
const spaceId = z.string().min(1).max(200);
export const authorFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    avatarDataUrl: profileAvatarSchema.nullable(),
  })
  .strict();
export const authorSchema = authorFieldsSchema.extend({
  ...authorSummarySchema.shape,
  id: z.string().uuid(),
  name: z.string().trim().max(200),
  revision: z.number().int().positive(),
  isCurrentUser: z.boolean(),
});
export const authorListInputSchema = z
  .object({
    spaceId,
    term: z.string().trim().max(200).default(''),
    offset: z.number().int().nonnegative().max(10000).default(0),
  })
  .strict();
export const authorListResultSchema = z
  .object({
    authors: z.array(authorSchema).max(30),
    nextOffset: z.number().int().nonnegative().nullable(),
  })
  .strict();
export const creationAuthorStateSchema = z
  .object({
    target: creationFormEntityRefSchema,
    revision: z.number().int().nonnegative(),
    authors: z.array(authorSchema),
    legacyAuthor: authorSummarySchema.nullable(),
  })
  .strict();
export const authorSelectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('EXISTING'), authorId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('REMOVE'), authorId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('NEW'), fields: authorFieldsSchema }).strict(),
  z.object({ kind: z.literal('UNSET') }).strict(),
]);
export const creationAuthorSetSchema = z
  .object({
    spaceId,
    target: creationFormEntityRefSchema,
    expectedRevision: z.number().int().nonnegative(),
    selection: authorSelectionSchema,
  })
  .strict();
export const authorUpdateSchema = z
  .object({
    spaceId,
    authorId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    fields: authorFieldsSchema,
  })
  .strict();
export const keywordInputSchema = z
  .object({
    spaceId,
    term: z.string().max(64).default(''),
    offset: z.number().int().min(0).max(2_000).default(0),
    retry: z.boolean().default(false),
  })
  .strict();
export const meCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('profile-get'), spaceId }).strict(),
  z.object({ kind: z.literal('profile-save'), spaceId, profile: userProfileSchema }).strict(),
  authorListInputSchema.extend({ kind: z.literal('authors-list') }).strict(),
  z.object({ kind: z.literal('creation-author'), spaceId, target: creationFormEntityRefSchema }).strict(),
  creationAuthorSetSchema.extend({ kind: z.literal('creation-author-set') }).strict(),
  authorUpdateSchema.extend({ kind: z.literal('author-update') }).strict(),
  keywordInputSchema.extend({ kind: z.literal('keywords') }).strict(),
]);
export const keywordResultSchema = z
  .object({
    spaceId,
    coverage: contentLookupResultSchema.shape.coverage,
    words: z
      .array(
        z
          .object({ term: z.string(), count: z.number().int().positive(), documents: z.number().int().positive() })
          .strict(),
      )
      .max(24),
    matches: contentLookupResultSchema.shape.items,
    nextOffset: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type UserProfile = z.infer<typeof userProfileSchema>;
export type Author = z.infer<typeof authorSchema>;
export type AuthorFields = z.infer<typeof authorFieldsSchema>;
export type CreationAuthorState = z.infer<typeof creationAuthorStateSchema>;
export type MeCommand = z.infer<typeof meCommandSchema>;
export type KeywordResult = z.infer<typeof keywordResultSchema>;
export interface MeApi {
  profile(spaceId: string): Promise<UserProfile>;
  saveProfile(spaceId: string, profile: UserProfile): Promise<UserProfile>;
  authors(input: z.input<typeof authorListInputSchema>): Promise<z.infer<typeof authorListResultSchema>>;
  creationAuthor(
    spaceId: string,
    target: z.infer<typeof creationFormEntityRefSchema>,
  ): Promise<CreationAuthorState | null>;
  setCreationAuthor(input: z.infer<typeof creationAuthorSetSchema>): Promise<CreationAuthorState>;
  updateAuthor(input: z.infer<typeof authorUpdateSchema>): Promise<Author>;
  keywords(input: z.input<typeof keywordInputSchema>): Promise<KeywordResult>;
}
