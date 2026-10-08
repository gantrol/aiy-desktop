import { z } from 'zod';

export const SCREEN_MAGNIFIER_CENTER_ID = 'screen-magnifier';
export const screenMagnifierSettingsSchema = z
  .object({
    scale: z.union([z.literal(1.5), z.literal(2), z.literal(3), z.literal(4)]).default(2),
    size: z.enum(['small', 'medium', 'large']).default('medium'),
  })
  .strict();
export const screenMagnifierStateSchema = z
  .object({
    availability: z.enum(['ready', 'disabled', 'unsupported']),
    status: z.enum(['off', 'starting', 'on', 'failed']),
  })
  .strict();
export const screenMagnifierActionSchema = z.enum(['start', 'stop']);
export type ScreenMagnifierSettings = z.infer<typeof screenMagnifierSettingsSchema>;
export type ScreenMagnifierState = z.infer<typeof screenMagnifierStateSchema>;
export type ScreenMagnifierAction = z.infer<typeof screenMagnifierActionSchema>;
export function screenMagnifierRunning(state?: ScreenMagnifierState) {
  return state?.status === 'starting' || state?.status === 'on';
}
