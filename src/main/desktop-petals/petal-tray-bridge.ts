import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { TrayPetalAction } from '@/shared/contracts/tray-menu';
import { petalError } from '@/shared/petal-errors';

interface Dependencies {
  ready(): Promise<void>;
  available(): boolean;
  context(): ActiveLibraryContext;
  execute(command: string, input: unknown, context: ActiveLibraryContext): Promise<unknown>;
  changed(): void;
}

/** Tray actions share the hub commands and the library operation guard. */
export function createPetalTrayBridge(deps: Dependencies) {
  let lastReady = false;
  return {
    get ready() {
      return deps.available();
    },
    update() {
      const ready = deps.available();
      if (lastReady === ready) return;
      lastReady = ready;
      deps.changed();
    },
    async run(action: TrayPetalAction) {
      await deps.ready();
      const context = deps.context();
      if (!deps.available()) throw petalError('saving');
      const release = context.acquireOperation();
      try {
        if (action === 'petals-open' || action === 'petals-settings') {
          await deps.execute('hub-view', action === 'petals-open' ? 'flower' : 'settings', context);
        } else {
          await deps.execute(action === 'petals-show-all' ? 'show-all' : 'hide-all', undefined, context);
        }
      } finally {
        release();
      }
    },
  };
}
