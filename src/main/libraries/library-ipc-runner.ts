import type { AsyncLocalStorage } from 'node:async_hooks';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';

interface Options {
  updating(): boolean;
  independentChannels: ReadonlySet<string>;
  context(): ActiveLibraryContext;
  storage: AsyncLocalStorage<ActiveLibraryContext>;
  afterInvoke?(channel: string): void;
}
const updateChannels = new Set([
  'app:request-quit',
  'app:loading-previews',
  'video-document:transcript-recognition-cancel',
  'video-document:transcript-translation-cancel',
  'video-document:transcript-background-tasks-get',
]);

export function createLibraryIpcRunner(options: Options) {
  return (channel: string, invoke: () => unknown) => {
    if (options.updating() && !updateChannels.has(channel))
      throw new Error('Application services are shutting down for an update');
    if (options.independentChannels.has(channel)) return invoke();
    const context = options.context();
    const release = context.acquireOperation();
    return options.storage.run(context, async () => {
      try {
        const result = await invoke();
        options.afterInvoke?.(channel);
        return result;
      } finally {
        release();
      }
    });
  };
}
