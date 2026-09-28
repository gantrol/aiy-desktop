import { z } from 'zod';

export const petalOverlayKindSchema = z.enum(['menu', 'hover', 'pluck']);
export type PetalOverlayKind = z.infer<typeof petalOverlayKindSchema>;
export const petalOverlayReadySchema = z
  .object({
    token: z.string().uuid(),
    point: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().optional(),
    height: z.number().int().min(1).max(200).optional(),
  })
  .strict();
export type PetalOverlayReady = z.infer<typeof petalOverlayReadySchema>;

export function petalOverlayName(kind: PetalOverlayKind, token: string) {
  return `aiy-petal-${kind}:${token}`;
}

export function parsePetalOverlayName(name: string) {
  const match = /^aiy-petal-(menu|hover|pluck):(.+)$/.exec(name);
  if (!match) return null;
  const token = z.string().uuid().safeParse(match[2]);
  return token.success ? { kind: petalOverlayKindSchema.parse(match[1]), token: token.data } : null;
}
