import type { IpcRenderer } from 'electron';
import { z } from 'zod';
import {
  calendarViewListSchema,
  calendarViewSchema,
  calendarViewSaveSchema,
  calendarViewDeleteSchema,
  calendarViewDeleteResultSchema,
} from '@/shared/calendar-views';
import {
  calendarUsageQuerySchema,
  calendarUsageResultSchema,
  calendarUsageRunsQuerySchema,
  calendarUsageRunsResultSchema,
} from '@/shared/calendar-usage';
import {
  calendarActivityCorrectionSchema,
  calendarHistoryInputSchema,
  calendarHistoryResultSchema,
  calendarItemSchema,
  calendarPreferencesSchema,
  calendarQueryResultSchema,
  calendarQuerySchema,
  calendarSummaryQuerySchema,
  calendarSummaryResultSchema,
  type CalendarApi,
} from '@/shared/contracts/calendar';

const spaceIdSchema = z.string().min(1).max(200);

export function createCalendarPreloadApi(ipc: Pick<IpcRenderer, 'invoke'>): CalendarApi {
  return {
    listViews: async (spaceId) =>
      calendarViewListSchema.parse(await ipc.invoke('calendar:list-views', spaceIdSchema.parse(spaceId))),
    saveView: async (input, spaceId) =>
      calendarViewSchema.parse(
        await ipc.invoke('calendar:save-view', calendarViewSaveSchema.parse(input), spaceIdSchema.parse(spaceId)),
      ),
    deleteView: async (input, spaceId) =>
      calendarViewDeleteResultSchema.parse(
        await ipc.invoke('calendar:delete-view', calendarViewDeleteSchema.parse(input), spaceIdSchema.parse(spaceId)),
      ),
    summary: async (input, spaceId) =>
      calendarSummaryResultSchema.parse(
        await ipc.invoke('calendar:summary', calendarSummaryQuerySchema.parse(input), spaceIdSchema.parse(spaceId)),
      ),
    usageRuns: async (input, spaceId) =>
      calendarUsageRunsResultSchema.parse(
        await ipc.invoke(
          'calendar:usage-runs',
          calendarUsageRunsQuerySchema.parse(input),
          spaceIdSchema.parse(spaceId),
        ),
      ),
    query: async (input, spaceId) =>
      calendarQueryResultSchema.parse(
        await ipc.invoke('calendar:query', calendarQuerySchema.parse(input), spaceIdSchema.parse(spaceId)),
      ),
    correctActivity: async (input, spaceId) =>
      calendarItemSchema.parse(
        await ipc.invoke(
          'calendar:correct-activity',
          calendarActivityCorrectionSchema.parse(input),
          spaceIdSchema.parse(spaceId),
        ),
      ),
    history: async (input, spaceId) =>
      calendarHistoryResultSchema.parse(
        await ipc.invoke('calendar:history', calendarHistoryInputSchema.parse(input), spaceIdSchema.parse(spaceId)),
      ),
    getPreferences: async (spaceId) =>
      calendarPreferencesSchema.parse(await ipc.invoke('calendar:get-preferences', spaceIdSchema.parse(spaceId))),
    savePreferences: async (input, spaceId) =>
      calendarPreferencesSchema.parse(
        await ipc.invoke(
          'calendar:save-preferences',
          calendarPreferencesSchema.parse(input),
          spaceIdSchema.parse(spaceId),
        ),
      ),
    usage: async (input, spaceId) =>
      calendarUsageResultSchema.parse(
        await ipc.invoke('calendar:usage', calendarUsageQuerySchema.parse(input), spaceIdSchema.parse(spaceId)),
      ),
  };
}
