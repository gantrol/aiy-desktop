import { TRANSITION_PREVIEW_LIMIT, type TransitionPreviewCache } from '@/main/app/transition-preview-cache';
import type { ActiveLibraryContext } from '@/main/libraries/active-library-context';
import type { TransitionPreviewDto } from '@/shared/contracts';

interface TransitionPreviewRatingRefreshOptions {
  cache: TransitionPreviewCache;
  getContext(): ActiveLibraryContext;
  isCurrentContext(context: ActiveLibraryContext): boolean;
  publish(spaceId: string, previews: TransitionPreviewDto[]): void;
}

interface PendingRefresh {
  context: ActiveLibraryContext;
  release: () => void;
  timer: ReturnType<typeof setTimeout>;
  token: symbol;
}

const ratingRefreshDelayMs = 250;

export function createTransitionPreviewRatingRefreshScheduler(options: TransitionPreviewRatingRefreshOptions) {
  const pendingByEpoch = new Map<number, PendingRefresh>();

  const run = async (epoch: number, token: symbol) => {
    const pending = pendingByEpoch.get(epoch);
    if (!pending || pending.token !== token) return;
    pendingByEpoch.delete(epoch);
    const { context, release } = pending;
    try {
      const candidates = context.database.listTransitionPreviewSources(TRANSITION_PREVIEW_LIMIT);
      const previews = await options.cache.refresh(context.library.id, candidates);
      if (previews && options.isCurrentContext(context)) options.publish(context.library.id, previews);
    } catch (error) {
      console.warn('[local-space] failed to refresh transition previews after rating', {
        libraryId: context.library.id,
        error,
      });
    } finally {
      release();
    }
  };

  return () => {
    const context = options.getContext();
    const current = pendingByEpoch.get(context.epoch);
    if (current) clearTimeout(current.timer);
    const token = Symbol('rating-preview-refresh');
    const pending: PendingRefresh = {
      context,
      release: current?.release ?? context.acquireOperation(),
      timer: setTimeout(() => void run(context.epoch, token), ratingRefreshDelayMs),
      token,
    };
    pendingByEpoch.set(context.epoch, pending);
  };
}
