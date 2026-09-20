import { z } from 'zod';

export const CONTENT_PACK_CREATION_BYTES = 4 * 1024 * 1024;
export const CONTENT_PACK_CREATION_WORK_LIMIT = 50;
export const CONTENT_PACK_CREATION_ITEM_LIMIT = 25;
const key = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/u);

/** A content package's creation section: every work is inline and belongs to exactly one creation item. */
export const contentPackCreationsSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().trim().min(1).max(200),
    titleLocale: z.enum(['zh', 'en']).default('zh'),
    description: z.string().max(2000).default(''),
    creationItems: z
      .array(
        z
          .object({
            key,
            primaryWorkKey: key,
            workKeys: z.array(key).min(1).max(CONTENT_PACK_CREATION_WORK_LIMIT),
          })
          .strict(),
      )
      .min(1)
      .max(CONTENT_PACK_CREATION_ITEM_LIMIT),
    works: z
      .array(
        z
          .object({
            key,
            kind: z.enum(['ARTICLE', 'OUTLINE']),
            title: z.string().trim().min(1).max(200),
            file: z
              .string()
              .max(200)
              .regex(/^[A-Za-z0-9_-]+\.md$/u),
            markdown: z.string().min(1).max(1_000_000),
          })
          .strict(),
      )
      .min(1)
      .max(CONTENT_PACK_CREATION_WORK_LIMIT),
  })
  .strict()
  .superRefine((album, context) => {
    const workKeys = new Set(album.works.map((work) => work.key));
    const members = album.creationItems.flatMap((item) => item.workKeys);
    const error = (message: string) => context.addIssue({ code: 'custom', message });
    if (workKeys.size !== album.works.length) error('Duplicate work key');
    if (new Set(album.works.map((work) => work.file)).size !== album.works.length) error('Duplicate work file');
    if (new Set(album.creationItems.map((item) => item.key)).size !== album.creationItems.length)
      error('Duplicate item key');
    if (
      members.length !== workKeys.size ||
      new Set(members).size !== members.length ||
      members.some((member) => !workKeys.has(member))
    )
      error('Every work must belong to exactly one creation item');
    if (album.creationItems.some((item) => !item.workKeys.includes(item.primaryWorkKey)))
      error('Primary work must be a member');
    if (album.works.reduce((size, work) => size + work.markdown.length, 0) > 3_000_000)
      error('Album text exceeds the total limit');
  });

export type ContentPackCreations = z.infer<typeof contentPackCreationsSchema>;
