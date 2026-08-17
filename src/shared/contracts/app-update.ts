import { z } from 'zod';

export const appUpdatePhaseSchema = z.enum([
  'UNSUPPORTED',
  'IDLE',
  'CHECKING',
  'AVAILABLE',
  'DOWNLOADING',
  'READY',
  'INSTALLING',
  'UP_TO_DATE',
  'ERROR',
]);

export const appUpdateSupportReasonSchema = z.enum([
  'DEVELOPMENT',
  'PACKAGE_TYPE',
  'CONFIGURATION',
  'SIGNATURE',
  'PLATFORM',
]);
export const appUpdateErrorActionSchema = z.enum(['CHECK', 'DOWNLOAD', 'INSTALL']);

export const appUpdateProgressSchema = z
  .object({
    percent: z.number().min(0).max(100),
    transferred: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    bytesPerSecond: z.number().nonnegative(),
  })
  .strict();

export const appUpdateErrorSchema = z
  .object({
    action: appUpdateErrorActionSchema,
    code: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[A-Z0-9_]+$/),
    retryable: z.boolean(),
  })
  .strict();

export const appUpdateStateSchema = z
  .object({
    phase: appUpdatePhaseSchema,
    currentVersion: z.string().min(1).max(64),
    supportReason: appUpdateSupportReasonSchema.nullable(),
    targetVersion: z.string().min(1).max(64).nullable(),
    releaseDate: z.string().datetime({ offset: true }).nullable(),
    progress: appUpdateProgressSchema.nullable(),
    error: appUpdateErrorSchema.nullable(),
  })
  .strict();

export type AppUpdatePhase = z.infer<typeof appUpdatePhaseSchema>;
export type AppUpdateSupportReason = z.infer<typeof appUpdateSupportReasonSchema>;
export type AppUpdateErrorAction = z.infer<typeof appUpdateErrorActionSchema>;
export type AppUpdateProgressDto = z.infer<typeof appUpdateProgressSchema>;
export type AppUpdateErrorDto = z.infer<typeof appUpdateErrorSchema>;
export type AppUpdateStateDto = z.infer<typeof appUpdateStateSchema>;
