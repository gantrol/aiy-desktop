import { z } from 'zod';
import { petalError } from '@/shared/petal-errors';

export const petalHubViewSchema = z.enum(['flower', 'notes', 'settings', 'layers', 'sources']);
export type PetalHubView = z.infer<typeof petalHubViewSchema>;
const timeZone = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, petalError('invalidTimeZone').message);
export const petalHubSettingsSchema = z
  .object({
    mode: z.enum(['none', 'clock', 'pomodoro', 'codex']).default('none'),
    title: z.string().max(200).default(''),
    timeZone: timeZone.default('UTC'),
    focusMinutes: z.number().int().min(1).max(180).default(25),
    breakMinutes: z.number().int().min(1).max(60).default(5),
    codexLimitId: z.string().max(512).nullable().default(null),
    flowerSize: z.number().int().min(128).max(184).default(144),
    timerNotification: z.boolean().default(true),
  })
  .strict();
export type PetalHubSettings = z.infer<typeof petalHubSettingsSchema>;
export const petalTimerSchema = z
  .object({
    phase: z.enum(['focus', 'break']).default('focus'),
    remainingMs: z
      .number()
      .int()
      .nonnegative()
      .default(25 * 60_000),
    endsAt: z.number().int().nonnegative().nullable().default(null),
  })
  .strict();
export type PetalTimer = z.infer<typeof petalTimerSchema>;
export const petalTimerActionSchema = z.enum(['start', 'pause', 'reset', 'next']);
export type PetalTimerAction = z.infer<typeof petalTimerActionSchema>;
const quotaWindow = z.object({
  remaining: z.number().min(0).max(100),
  durationMins: z.number().nullable(),
  resetsAt: z.number().nullable(),
});
export const petalQuotaSchema = z.object({
  state: z.enum(['ready', 'unavailable', 'permission-required', 'select-limit']),
  // Kept for older preload consumers. Presentation uses messageCode, never provider text.
  message: z.string().default(''),
  messageCode: z
    .enum(['notSelected', 'permissionRequired', 'unavailable', 'selectLimit', 'noData', 'remaining'])
    .optional(),
  capturedAt: z.string().nullable(),
  primary: quotaWindow.nullable(),
  secondary: quotaWindow.nullable(),
  limits: z.array(z.object({ id: z.string(), name: z.string() })),
});
export type PetalQuota = z.infer<typeof petalQuotaSchema>;

/** One geometry contract for native windows and renderer components, in device-independent pixels. */
export const PETAL_WINDOW_SIZES = {
  collapsed: { width: 112, height: 112 },
  note: { width: 328, height: 362 },
  flower: { width: 224, height: 224 },
  notes: { width: 520, height: 580 },
  settings: { width: 328, height: 470 },
  layers: { width: 300, height: 360 },
  sources: { width: 328, height: 410 },
} as const;
