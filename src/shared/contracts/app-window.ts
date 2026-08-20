import { z } from 'zod';

export const desktopPlatformSchema = z.enum(['darwin', 'linux', 'win32']);

export const appWindowStateSchema = z
  .object({
    maximized: z.boolean(),
  })
  .strict();

export type DesktopPlatform = z.infer<typeof desktopPlatformSchema>;
export type AppWindowStateDto = z.infer<typeof appWindowStateSchema>;
