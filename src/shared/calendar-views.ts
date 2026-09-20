import { z } from 'zod';
import { calendarPreferencesSchema } from '@/shared/contracts/calendar';

const viewId = z.string().min(1).max(200);
const name = z.string().trim().min(1).max(100);
export const calendarViewSchema = z
  .object({
    id: viewId,
    name,
    preferences: calendarPreferencesSchema,
    revision: z.number().int().positive().safe(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export const calendarViewListSchema = z.array(calendarViewSchema).max(50);
export const calendarViewSaveSchema = z
  .object({
    id: viewId.optional(),
    expectedRevision: z.number().int().positive().safe().optional(),
    name,
    preferences: calendarPreferencesSchema,
  })
  .strict()
  .refine(
    (value) => (value.id === undefined) === (value.expectedRevision === undefined),
    'Editing a view requires its id and expected revision',
  );
export const calendarViewDeleteSchema = z
  .object({
    id: viewId,
    expectedRevision: z.number().int().positive().safe(),
  })
  .strict();
export const calendarViewDeleteResultSchema = z.object({ deleted: z.literal(true) }).strict();
export type CalendarView = z.infer<typeof calendarViewSchema>;
export type CalendarViewSaveInput = z.input<typeof calendarViewSaveSchema>;
export type CalendarViewDeleteInput = z.infer<typeof calendarViewDeleteSchema>;
