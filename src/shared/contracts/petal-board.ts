import { z } from 'zod';
import { petalColorSchema, petalIconSchema } from '@/shared/contracts/petal-appearance';
import { PIN_SOURCE_KINDS } from '@/shared/petal-source-kinds';

const id = z.string().min(1).max(200);
export const pinSourceSchema = z.object({ kind: z.enum(PIN_SOURCE_KINDS), id }).strict();
export type PinSource = z.infer<typeof pinSourceSchema>;
export const pinMediaSchema = z.object({
  id,
  mediaUrl: z.string(),
  mimeType: z.string(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  byteSize: z.number().nonnegative(),
});
export const pinSummarySchema = z.object({
  source: pinSourceSchema,
  title: z.string(),
  preview: z.string(),
  mediaUrl: z.string().nullable(),
  // Optional during rolling updates and for legacy fixtures. Never infer MIME from the source kind.
  media: pinMediaSchema.nullable().optional(),
});
export const desktopPinSchema = pinSummarySchema.extend({
  id,
  color: petalColorSchema,
  icon: petalIconSchema,
  layerId: id,
});
export type DesktopPin = z.infer<typeof desktopPinSchema>;
export const petalLayerSchema = z.object({ id, name: z.string(), color: desktopPinSchema.shape.color });
export type PetalLayer = z.infer<typeof petalLayerSchema>;
export const petalBoardSchema = z
  .object({
    pins: z.array(desktopPinSchema),
    layers: z.array(petalLayerSchema),
    memberships: z.record(z.string(), z.string()),
    activeLayerId: id,
    hiddenLayerIds: z.array(id),
  })
  .default(() => ({
    pins: [],
    layers: [{ id: 'default', name: '', color: 'rose' as const }],
    memberships: {},
    activeLayerId: 'default',
    hiddenLayerIds: [],
  }));
export type PetalBoard = z.infer<typeof petalBoardSchema>;
export const petalBoardCommandSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('pin-appearance'),
      id,
      color: desktopPinSchema.shape.color.optional(),
      icon: desktopPinSchema.shape.icon.optional(),
    })
    .strict(),
  z.object({ kind: z.literal('pin'), source: pinSourceSchema }).strict(),
  z.object({ kind: z.literal('unpin'), id }).strict(),
  z.object({ kind: z.literal('create-layer'), name: z.string().trim().min(1).max(40) }).strict(),
  z.object({ kind: z.literal('rename-layer'), id, name: z.string().trim().min(1).max(40) }).strict(),
  z.object({ kind: z.literal('remove-layer'), id }).strict(),
  z.object({ kind: z.literal('select-layer'), id }).strict(),
  z.object({ kind: z.literal('toggle-layer'), id }).strict(),
  z.object({ kind: z.literal('assign-layer'), id, layerId: id }).strict(),
]);
export type PetalBoardCommand = z.infer<typeof petalBoardCommandSchema>;
export const pinSearchSchema = z
  .object({
    kind: pinSourceSchema.shape.kind,
    query: z.string().max(100),
    offset: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
export type PinSearch = z.infer<typeof pinSearchSchema>;
export type PinSummary = z.infer<typeof pinSummarySchema>;
/** Namespaced window identity keeps content references separate from editable note instances. */
export function isContentPinId(id: string | null | undefined): id is `pin:${string}` {
  return !!id?.startsWith('pin:');
}
