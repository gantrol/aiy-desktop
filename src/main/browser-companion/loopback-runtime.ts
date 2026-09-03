import { app } from 'electron';
import { BrowserCompanionLoopbackServer } from '@/main/browser-companion/loopback-server';
import { createBrowserCompanionOutputImporter } from '@/main/browser-companion/output-importer';
import type { RendererEventDispatcher } from '@/main/app/renderer-event-dispatcher';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { GenerationChangedEvent } from '@/shared/contracts';

export function createCompanionLoopback(
  getActiveContext: () => ActiveLibraryContext | null,
  rendererEvents: RendererEventDispatcher,
): BrowserCompanionLoopbackServer {
  const service = BrowserCompanionLoopbackServer.forAppData(app.getPath('appData'), process.env);
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
