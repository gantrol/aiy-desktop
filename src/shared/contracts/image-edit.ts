import { z } from 'zod';

export const IMAGE_EDIT_MAX_PIXELS = 32_000_000;
export const IMAGE_EDIT_MAX_EDGE = 16384;
const coordinate = z.number().finite().min(-16384).max(32768);
const size = z.number().int().min(1).max(IMAGE_EDIT_MAX_EDGE);
export const imageEditPointSchema = z.object({ x: coordinate, y: coordinate }).strict();
export const imageEditMarkSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(['arrow', 'rectangle', 'text', 'cover', 'highlight', 'pen', 'number']),
    x: coordinate,
    y: coordinate,
    width: coordinate,
    height: coordinate,
    color: z.string().regex(/^#[\da-f]{6}$/i),
    stroke: z.number().min(1).max(100),
    fontSize: z.number().min(8).max(240),
    text: z.string().max(2000),
    points: z.array(imageEditPointSchema).max(2000).optional(),
  })
  .strict();
export const imageEditDocumentSchema = z
  .object({
    version: z.literal(1),
    width: size,
    height: size,
    crop: z
      .object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: size, height: size })
      .strict(),
    rotation: z.number().int().min(0).max(3),
    flipX: z.boolean(),
    flipY: z.boolean(),
    marks: z.array(imageEditMarkSchema).max(300),
  })
  .strict()
  .refine(
    (value) =>
      value.width * value.height <= IMAGE_EDIT_MAX_PIXELS &&
      value.marks.reduce((total, mark) => total + (mark.points?.length ?? 0), 0) <= 12000 &&
      value.crop.x + value.crop.width <= value.width &&
      value.crop.y + value.crop.height <= value.height,
  );
export const imageEditRecordSchema = z
  .object({
    sourceAssetId: z.string().uuid(),
    resultAssetId: z.string().uuid(),
    revision: z.string(),
    document: imageEditDocumentSchema,
    draft: imageEditDocumentSchema.nullable(),
  })
  .strict();
export const imageEditSnapshotSchema = imageEditRecordSchema.extend({
  sourceUrl: z.string(),
});
const mutation = z.object({ expectedRevision: z.string(), requestId: z.string().uuid() });
export const imageEditCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('load') }).strict(),
  mutation.extend({ kind: z.literal('checkpoint'), document: imageEditDocumentSchema }).strict(),
  mutation.extend({ kind: z.literal('cancel') }).strict(),
  mutation
    .extend({
      kind: z.literal('commit'),
      document: imageEditDocumentSchema,
      bytes: z.custom<Uint8Array>(
        (value) => value instanceof Uint8Array && value.byteLength > 0 && value.byteLength <= 25 * 1024 * 1024,
      ),
    })
    .strict(),
]);
export type ImageEditDocument = z.infer<typeof imageEditDocumentSchema>;
export type ImageEditMark = z.infer<typeof imageEditMarkSchema>;
export type ImageEditRecord = z.infer<typeof imageEditRecordSchema>;
export type ImageEditSnapshot = z.infer<typeof imageEditSnapshotSchema>;
export type ImageEditCommand = z.infer<typeof imageEditCommandSchema>;

export function emptyImageEdit(width: number, height: number): ImageEditDocument {
  return imageEditDocumentSchema.parse({
    version: 1,
    width,
    height,
    crop: { x: 0, y: 0, width, height },
    rotation: 0,
    flipX: false,
    flipY: false,
    marks: [],
  });
}
