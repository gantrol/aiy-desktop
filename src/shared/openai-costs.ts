import { z } from 'zod';

const organizationId = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/)
  .nullable();
export const openAiCostsConnectionSaveSchema = z
  .object({
    adminKey: z.string().trim().max(500).default(''),
    /** Optional request routing, not a verified account identity. */
    organizationId: organizationId.default(null),
  })
  .strict()
  .refine((value) => value.adminKey === '' || (value.adminKey.length >= 20 && /^[\x21-\x7e]+$/.test(value.adminKey)), {
    message: 'OpenAI administrator key is invalid',
    path: ['adminKey'],
  });
export const openAiCostsConnectionClearSchema = z.object({}).strict();
export const openAiCostsConnectionStatusSchema = z
  .object({
    configured: z.boolean(),
    connectionId: z.string().uuid().nullable(),
    organizationId,
    state: z.enum(['NOT_CONFIGURED', 'CONFIGURED', 'ERROR']),
    updatedAt: z.string().datetime().nullable(),
    message: z.string().max(200).nullable(),
  })
  .strict();
export const openAiCostsRangeSchema = z
  .object({
    startTime: z.number().int().nonnegative().safe(),
    endTime: z.number().int().positive().safe(),
  })
  .strict()
  .refine((value) => value.endTime > value.startTime && value.endTime - value.startTime <= 366 * 86_400, {
    message: 'OpenAI costs range must be positive and at most 366 days',
  });

export type OpenAiCostsConnectionSaveInput = z.input<typeof openAiCostsConnectionSaveSchema>;
export type OpenAiCostsConnectionClearInput = z.infer<typeof openAiCostsConnectionClearSchema>;
export type OpenAiCostsConnectionStatus = z.infer<typeof openAiCostsConnectionStatusSchema>;
export type OpenAiCostsRange = z.infer<typeof openAiCostsRangeSchema>;

/** Application-wide plugin connection; secrets are never returned to the renderer. */
export interface OpenAiCostsConnectionApi {
  status(): Promise<OpenAiCostsConnectionStatus>;
  save(input: OpenAiCostsConnectionSaveInput): Promise<OpenAiCostsConnectionStatus>;
  clear(): Promise<OpenAiCostsConnectionStatus>;
}

export interface OpenAiCostsResult {
  /** Decimal JSON number text; never rounded through a JavaScript number. */
  amount: { value: string | null; currency: string | null } | null;
  quantity: string | null;
  quantityUnit: string | null;
  projectId: string | null;
  lineItem: string | null;
  apiKeyId: string | null;
}
export interface OpenAiCostsBucket {
  startTime: number;
  endTime: number;
  results: OpenAiCostsResult[];
}
export interface OpenAiCostsPage {
  buckets: OpenAiCostsBucket[];
  hasMore: boolean;
  nextPage: string | null;
}
export interface OpenAiCostsRefreshResult extends OpenAiCostsRange {
  connectionId: string;
  capturedAt: string;
  pages: OpenAiCostsPage[];
}
