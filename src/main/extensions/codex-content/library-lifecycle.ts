import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { LibraryContextLifecycle } from '@/main/libraries/library-context-lifecycle';

export function codexContentLifecycle(
  service: ActiveLibraryContext['codexContent'],
  lifecycle: LibraryContextLifecycle,
) {
  return {
    codexContent: service,
    async drain() {
      const idle = lifecycle.drain();
      await service.drain();
      await idle;
    },
    resume() {
      service.resume();
      lifecycle.resume();
    },
  };
}
