import { z } from 'zod';

export const appSupportDestinationSchema = z.literal('PRIVACY_POLICY');

export type AppSupportDestination = z.infer<typeof appSupportDestinationSchema>;
