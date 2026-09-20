import { z } from 'zod';
import {
  calendarViewListSchema,
  calendarViewSchema,
  calendarViewSaveSchema,
  calendarViewDeleteSchema,
  calendarViewDeleteResultSchema,
} from '@/shared/calendar-views';
import { CalendarViewRepository } from '@/main/database/calendar/calendar-views';
import type { LibraryDatabase } from '@/main/database';
import { CalendarRepository } from '@/main/database/calendar/calendar-repository';
import { listCalendarUsage, listCalendarUsageRuns } from '@/main/database/calendar/calendar-usage';
import type { IpcHandlerRegistrar } from '@/main/ipc/trusted-handlers';
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
} from '@/shared/contracts/calendar';

const spaceIdSchema = z.string().min(1).max(200);

/** Keep operations synchronous inside the trusted, current-library invocation. */
export function registerCalendarIpc(ipc: IpcHandlerRegistrar, database: LibraryDatabase) {
  function current(rawSpaceId: unknown) {
    const spaceId = spaceIdSchema.parse(rawSpaceId);
    if (database.getLocalSpace().id !== spaceId) throw new Error('CALENDAR_SPACE_CHANGED');
    return database.db;
  }
  ipc.handle('calendar:query', (_event, raw, spaceId) =>
    calendarQueryResultSchema.parse(new CalendarRepository(current(spaceId)).query(calendarQuerySchema.parse(raw))),
  );
  ipc.handle('calendar:list-views', (_event, spaceId) =>
    calendarViewListSchema.parse(new CalendarViewRepository(current(spaceId)).list()),
  );
  ipc.handle('calendar:save-view', (_event, raw, spaceId) =>
    calendarViewSchema.parse(new CalendarViewRepository(current(spaceId)).save(calendarViewSaveSchema.parse(raw))),
  );
  ipc.handle('calendar:delete-view', (_event, raw, spaceId) =>
    calendarViewDeleteResultSchema.parse(
      new CalendarViewRepository(current(spaceId)).delete(calendarViewDeleteSchema.parse(raw)),
    ),
  );
  ipc.handle('calendar:summary', (_event, raw, spaceId) =>
    calendarSummaryResultSchema.parse(
      new CalendarRepository(current(spaceId)).summary(calendarSummaryQuerySchema.parse(raw)),
    ),
  );
  ipc.handle('calendar:usage-runs', (_event, raw, spaceId) =>
    calendarUsageRunsResultSchema.parse(
      listCalendarUsageRuns(current(spaceId), calendarUsageRunsQuerySchema.parse(raw)),
    ),
  );
  ipc.handle('calendar:correct-activity', (_event, raw, spaceId) =>
    calendarItemSchema.parse(
      new CalendarRepository(current(spaceId)).correctActivity(calendarActivityCorrectionSchema.parse(raw)),
    ),
  );
  ipc.handle('calendar:history', (_event, raw, spaceId) =>
    calendarHistoryResultSchema.parse(
      new CalendarRepository(current(spaceId)).history(calendarHistoryInputSchema.parse(raw)),
    ),
  );
  ipc.handle('calendar:get-preferences', (_event, spaceId) =>
    calendarPreferencesSchema.parse(new CalendarRepository(current(spaceId)).getPreferences()),
  );
  ipc.handle('calendar:save-preferences', (_event, raw, spaceId) =>
    calendarPreferencesSchema.parse(
      new CalendarRepository(current(spaceId)).savePreferences(calendarPreferencesSchema.parse(raw)),
    ),
  );
  ipc.handle('calendar:usage', (_event, raw, spaceId) =>
    calendarUsageResultSchema.parse(listCalendarUsage(current(spaceId), calendarUsageQuerySchema.parse(raw))),
  );
}
