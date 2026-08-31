import { z } from 'zod';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);

const settingKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z][A-Za-z0-9._-]*$/);

export const providerConnectionStateSchema = z.enum(['NOT_CONFIGURED', 'UNVERIFIED', 'READY', 'ERROR']);

export const providerConnectionActionSchema = z.enum(['SAVE', 'VERIFY', 'REMOVE']);

export const providerConnectionSettingsSchema = z
  .record(settingKeySchema, z.string().max(2_048))
  .superRefine((settings, context) => {
    if (Object.keys(settings).length > 50) {
      context.addIssue({ code: 'custom', message: 'Provider connection has too many settings' });
    }
  });

export const providerConnectionSchema = z
  .object({
    connectionId: identifierSchema,
    providerId: identifierSchema,
    extensionId: identifierSchema,
    kind: z.literal('REMOTE_API'),
    configured: z.boolean(),
    connectionState: providerConnectionStateSchema,
    message: z.string().max(2_000),
    credentialHint: z.string().max(200).nullable(),
    modelId: z.string().max(200).nullable(),
    settings: providerConnectionSettingsSchema,
    supportedActions: z.array(providerConnectionActionSchema).min(1).max(3),
    updatedAt: z.string().datetime({ offset: true }).nullable(),
    lastVerifiedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export const providerConnectionListSchema = z.array(providerConnectionSchema).max(50);

export const providerConnectionTargetInputSchema = z.object({ connectionId: identifierSchema }).strict();

export const providerConnectionSaveInputSchema = providerConnectionTargetInputSchema
  .extend({
    apiKey: z.string().max(500),
    settings: providerConnectionSettingsSchema,
  })
  .strict();

export type ProviderConnectionState = z.infer<typeof providerConnectionStateSchema>;
export type ProviderConnectionAction = z.infer<typeof providerConnectionActionSchema>;
export type ProviderConnectionDto = z.infer<typeof providerConnectionSchema>;
export type ProviderConnectionTargetInput = z.infer<typeof providerConnectionTargetInputSchema>;
export type ProviderConnectionSaveInput = z.infer<typeof providerConnectionSaveInputSchema>;
