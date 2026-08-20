import { z } from 'zod';

export const appSupportDestinationSchema = z.enum(['PRIVACY_POLICY', 'AI_CONTENT_REPORT']);

export type AppSupportDestination = z.infer<typeof appSupportDestinationSchema>;
