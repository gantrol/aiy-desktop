import { z } from 'zod';
import { petalColorSchema, petalIconSchema } from '@/shared/contracts/petal-appearance';
import { pinSourceSchema } from '@/shared/contracts/petal-board';

// Drawer interaction is deferred beyond 0.5.0; keep its persisted data readable.
export const PETAL_DRAWER_ENABLED = false;

const id = z.string().min(1).max(200);
const point = z.object({ x: z.number().int().min(-100000).max(100000), y: z.number().int().min(-100000).max(100000) });
export const petalDrawerItemSchema = z.object({
  id,
  title: z.string(),
  sourceKind: z.enum(['NOTE', ...pinSourceSchema.shape.kind.options]).default('NOTE'),
  color: petalColorSchema,
  icon: petalIconSchema,
  layerId: id,
  opened: z.boolean(),
});
export type PetalDrawerItem = z.infer<typeof petalDrawerItemSchema>;
export const petalDrawerPositionSchema = z.union([
  z.object({ displayId: z.string(), xRatio: z.number().min(0).max(1), yRatio: z.number().min(0).max(1) }),
  z
    .object({ displayId: z.string(), edge: z.enum(['left', 'right']), ratio: z.number().min(0).max(1) })
    .transform((old) => ({ displayId: old.displayId, xRatio: old.edge === 'left' ? 0.2 : 0.8, yRatio: old.ratio })),
]);
export const petalDrawerLayoutSchema = z.object({
  visible: z.boolean().default(true),
  name: z.string().trim().max(40).default(''),
  order: z.array(id).default([]),
  anchorId: id.nullable().default(null),
  profiles: z.record(z.string(), petalDrawerPositionSchema).default({}),
});
export type PetalDrawerLayout = z.infer<typeof petalDrawerLayoutSchema>;
export type PetalDrawerPosition = z.infer<typeof petalDrawerPositionSchema>;
export const petalDrawerFrameSchema = z.object({
  revision: z.number().int().nonnegative(),
  interactionEpoch: z.number().int().nonnegative(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  canvasX: z.number(),
  canvasY: z.number(),
  handleY: z.number(),
  handleX: z.number(),
  contentX: z.number(),
  contentWidth: z.number(),
  bodyWidth: z.number(),
  bodyHeight: z.number(),
  columns: z.number(),
  rows: z.number(),
  progress: z.number(),
  edge: z.enum(['left', 'right']),
  moving: z.boolean(),
  menu: z.boolean(),
  dropPoint: point.nullable().default(null),
});
export type PetalDrawerFrame = z.infer<typeof petalDrawerFrameSchema>;
export const petalDrawerStateSchema = z.object({
  items: z.array(petalDrawerItemSchema),
  name: z.string().default(''),
  frame: petalDrawerFrameSchema,
  anchorId: id.nullable(),
  canUndo: z.boolean(),
  screens: z.array(z.object({ id: z.string(), label: z.string() })),
});
export type PetalDrawerState = z.infer<typeof petalDrawerStateSchema>;
export const petalDrawerCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('show') }).strict(),
  z.object({ kind: z.literal('hide') }).strict(),
  z.object({ kind: z.literal('rename'), name: z.string().trim().min(1).max(40) }).strict(),
  z.object({ kind: z.literal('hover'), active: z.boolean(), reduced: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('toggle-titles') }).strict(),
  z.object({ kind: z.literal('toggle'), reduced: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('collapse'), reduced: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('begin-pull'), point, token: z.string().uuid().optional() }).strict(),
  z.object({ kind: z.literal('pull'), point }).strict(),
  z.object({ kind: z.literal('end-pull'), cancel: z.boolean(), reduced: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal('menu'), open: z.boolean(), point: point.optional() }).strict(),
  z.object({ kind: z.literal('move-mode') }).strict(),
  z.object({ kind: z.literal('move-screen'), displayId: z.string() }).strict(),
  z
    .object({
      kind: z.literal('move-key'),
      dx: z.number().int().min(-100).max(100),
      dy: z.number().int().min(-100).max(100),
      finish: z.boolean().optional(),
      cancel: z.boolean().optional(),
    })
    .strict(),
  z.object({ kind: z.literal('store'), id, beforeId: id.nullable().optional() }).strict(),
  z.object({ kind: z.literal('take'), id, point: point.optional() }).strict(),
  z.object({ kind: z.literal('reorder'), id, beforeId: id.nullable() }).strict(),
  z.object({ kind: z.literal('collect-layer') }).strict(),
  z.object({ kind: z.literal('undo') }).strict(),
  z.object({ kind: z.literal('anchor'), id: id.nullable() }).strict(),
  z.object({ kind: z.literal('dragging'), active: z.boolean(), token: z.string().uuid().optional() }).strict(),
  z.object({ kind: z.literal('drop-target'), beforeId: id.nullable().optional() }).strict(),
  z.object({ kind: z.literal('visibility'), id, visible: z.boolean() }).strict(),
  z.object({ kind: z.literal('remove'), id }).strict(),
]);
export type PetalDrawerCommand = z.infer<typeof petalDrawerCommandSchema>;

export const PETAL_DRAWER = {
  handle: 80,
  handleHeight: 152,
  separation: 8,
  cellWidth: 86,
  cellHeight: 70,
  gap: 6,
  padding: 12,
  gridTop: 10,
  columns: 6,
  rows: 1,
} as const;

export const PETAL_DRAWER_COLUMN = PETAL_DRAWER.cellWidth + PETAL_DRAWER.gap;
export const PETAL_DRAWER_ROW = PETAL_DRAWER.cellHeight + PETAL_DRAWER.gap;
export const petalDrawerWidth = (columns: number) =>
  PETAL_DRAWER.handle +
  PETAL_DRAWER.separation +
  PETAL_DRAWER.padding * 2 +
  2 +
  columns * PETAL_DRAWER_COLUMN -
  PETAL_DRAWER.gap;
export const petalDrawerHeight = (rows: number) =>
  PETAL_DRAWER.gridTop * 2 + 2 + rows * PETAL_DRAWER_ROW - PETAL_DRAWER.gap;

export const petalDrawerPointerSchema = z.object({ token: z.string().uuid(), point, released: z.boolean() });
export type PetalDrawerPointer = z.infer<typeof petalDrawerPointerSchema>;
