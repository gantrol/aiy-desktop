import { z } from 'zod';

export const petalWindowToolsCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('get') }).strict(),
  z
    .object({
      kind: z.literal('set'),
      opacity: z.number().finite().min(0.2).max(1).optional(),
      locked: z.boolean().optional(),
      clickThrough: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('nudge'),
      x: z.number().int().min(-100).max(100),
      y: z.number().int().min(-100).max(100),
    })
    .strict(),
  z.object({ kind: z.literal('display'), id: z.number().int() }).strict(),
  z.object({ kind: z.literal('recover') }).strict(),
  z.object({ kind: z.literal('editing'), active: z.boolean() }).strict(),
  z.object({ kind: z.literal('imageZoom'), direction: z.union([z.literal(-1), z.literal(1)]) }).strict(),
  z
    .object({
      kind: z.literal('imageSize'),
      width: z.number().int().min(32).max(16384),
      height: z.number().int().min(32).max(16384),
    })
    .strict(),
]);
export const petalWindowToolsStateSchema = z.object({
  opacity: z.number().min(0.2).max(1),
  locked: z.boolean(),
  clickThrough: z.boolean(),
  displayId: z.number().int(),
  displays: z.array(z.object({ id: z.number().int(), label: z.string() })).max(64),
});
export type PetalWindowToolsCommand = z.infer<typeof petalWindowToolsCommandSchema>;
export type PetalWindowToolsState = z.infer<typeof petalWindowToolsStateSchema>;
