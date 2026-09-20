import { app } from 'electron';
import { BrowserCompanionLoopbackServer } from '@/main/browser-companion/loopback-server';
import { createBrowserCompanionOutputImporter } from '@/main/browser-companion/output-importer';
import type { RendererEventDispatcher } from '@/main/app/renderer-event-dispatcher';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { GenerationChangedEvent } from '@/shared/contracts';
import { recordCalendarHandoffEvents } from '@/main/database/calendar/calendar-handoff-capture';

export function createCompanionLoopback(
  getActiveContext: () => ActiveLibraryContext | null,
  rendererEvents: RendererEventDispatcher,
): BrowserCompanionLoopbackServer {
  const service = BrowserCompanionLoopbackServer.forAppData(app.getPath('appData'), process.env);
  service.handoffs.setCalendarRecorder((handoffId, target, capture) => {
    const context = getActiveContext();
    if (!context || context.state !== 'ACTIVE' || context.library.id !== capture.libraryId) return false;
    const release = context.acquireOperation();
    try {
      return recordCalendarHandoffEvents(context.database.db, handoffId, target, capture);
    } finally {
      release();
    }
  });
  service.setOutputImporter(
    createBrowserCompanionOutputImporter({
      getActiveContext,
      onImported: (context) =>
        rendererEvents.send('generation:changed', {
          runId: '',
          tasks: context.generation.tasks,
          terminal: false,
        } satisfies GenerationChangedEvent),
    }),
  );
  return service;
}
