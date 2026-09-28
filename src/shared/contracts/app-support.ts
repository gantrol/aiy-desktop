import { z } from 'zod';

export const appSupportDestinationSchema = z.enum([
  'PRIVACY_POLICY',
  'FONT_SOURCE_SANS',
  'FONT_SOURCE_SERIF',
  'FONT_WENKAI',
  'FONT_INTER',
  'FONT_JETBRAINS',
]);

export type AppSupportDestination = z.infer<typeof appSupportDestinationSchema>;
