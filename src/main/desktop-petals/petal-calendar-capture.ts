import { recordCalendarCapturedEvents } from '@/main/database/calendar/calendar-file-capture';
import type { PetalCalendarCapture } from '@/main/desktop-petals/petal-layout-store';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';

/** Layout receipts retain their owning library while activation or database delivery is pending. */
export function createPetalCalendarCapture(getContext: () => ActiveLibraryContext | null): PetalCalendarCapture {
  return {
    include: (libraryId, entityType, entityId) => {
      const context = getContext();
      if (!context || context.library.id !== libraryId) return true;
      const table = {
        DESKTOP_NOTE_INSTANCE: 'desktop_note_instances',
        DESKTOP_CONTENT_PIN: 'desktop_content_pins',
        PETAL_LAYER: 'desktop_petal_layers',
      }[entityType];
      // Pending notes and removed layers do not become show/hide events.
      return Boolean(context.database.db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(entityId));
    },
    record: (libraryId, events) => {
      const context = getContext();
      if (context?.state !== 'ACTIVE' || context.library.id !== libraryId) return false;
      recordCalendarCapturedEvents(context.database.db, events);
      return true;
    },
  };
}
