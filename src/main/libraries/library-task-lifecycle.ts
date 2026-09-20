import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { LibraryContextLifecycle } from '@/main/libraries/library-context-lifecycle';
import { codexContentLifecycle } from '@/main/extensions/codex-content/library-lifecycle';

export function libraryTaskLifecycle(
  codexContent: ActiveLibraryContext['codexContent'],
  uploads: ActiveLibraryContext['articleDeliveryJobs'],
  lifecycle: LibraryContextLifecycle,
  onResume: () => void,
) {
  const content = codexContentLifecycle(codexContent, lifecycle);
  let restartUploads = false;
  return {
    codexContent,
    async drain() {
      restartUploads ||= uploads.isStarted;
      // Stop requests before the library barrier waits for their operation leases.
      const uploadsStopped = uploads.stopAndDrain();
      await Promise.all([content.drain(), uploadsStopped]);
    },
    resume() {
      content.resume();
      if (lifecycle.state !== 'ACTIVE') return;
      uploads.resumeUploads();
      if (restartUploads) {
        restartUploads = false;
        uploads.start();
      }
      onResume();
    },
    dispose(cleanup: () => void | Promise<void>) {
      restartUploads = false;
      const uploadsStopped = uploads.stopAndDrain();
      return lifecycle.dispose(async () => {
        await uploadsStopped;
        await cleanup();
      });
    },
  };
}
