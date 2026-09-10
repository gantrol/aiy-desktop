import { useEffect, useRef } from 'react';
import type { BootstrapDto, GenerationProjectionDto, GenerationTaskDto, Locale } from '@/shared/contracts';
import {
  createTrailingRefreshQueue,
  requestTrailingRefresh,
  type TrailingRefreshQueue,
} from '@/renderer/startupRefreshQueue';

export interface GenerationProjectionRefreshContext {
  waitForFullRefresh(): Promise<unknown>;
  readLocale(): Locale;
  readFullRefreshRevision(): number;
  load(locale: Locale): Promise<GenerationProjectionDto>;
  apply(projection: GenerationProjectionDto): void;
  onError?(reason: unknown): void;
}

export type GenerationProjectionRefreshQueue = TrailingRefreshQueue<never>;

interface GenerationProjectionEventsContext extends GenerationProjectionRefreshContext {
  refreshAll(): Promise<unknown>;
  applyTasks(tasks: GenerationTaskDto[]): void;
}

export function createGenerationProjectionRefreshQueue(): GenerationProjectionRefreshQueue {
  return createTrailingRefreshQueue<never>();
}

/**
 * Coalesces terminal events while keeping full bootstrap authoritative. A
 * locale change or any full refresh that starts during the request invalidates
 * the projection response instead of letting an older partial snapshot win.
 */
export function requestGenerationProjectionRefresh(
  queue: GenerationProjectionRefreshQueue,
  context: GenerationProjectionRefreshContext,
) {
  return requestTrailingRefresh(queue, async () => {
    try {
      await context.waitForFullRefresh();
    } catch {
      // Full bootstrap reports its own error; the projection can still retry
      // the smaller generation-owned read against the current database.
    }
    const locale = context.readLocale();
    const revision = context.readFullRefreshRevision();
    try {
      const projection = await context.load(locale);
      if (context.readLocale() !== locale || context.readFullRefreshRevision() !== revision) return;
      context.apply(projection);
    } catch (reason) {
      if (context.readLocale() === locale && context.readFullRefreshRevision() === revision) {
        context.onError?.(reason);
      }
    }
  });
}

export function mergeGenerationProjection(
  current: BootstrapDto | null,
  projection: GenerationProjectionDto,
): BootstrapDto | null {
  return current
    ? {
        ...current,
        series: projection.series,
        albums: projection.albums,
        creationItems: projection.creationItems,
        animations: projection.animations,
        styleExplorationBatches: projection.styleExplorationBatches,
        agentTasks: projection.agentTasks,
      }
    : current;
}

export function useGenerationProjectionEvents(context: GenerationProjectionEventsContext) {
  const contextRef = useRef(context);
  contextRef.current = context;
  const queueRef = useRef(createGenerationProjectionRefreshQueue());

  useEffect(
    () =>
      window.desktopApi.onGenerationChanged((event) => {
        contextRef.current.applyTasks(event.tasks);
        if (!event.runId) {
          void contextRef.current.refreshAll();
        } else if (event.terminal) {
          void requestGenerationProjectionRefresh(queueRef.current, {
            waitForFullRefresh: () => contextRef.current.waitForFullRefresh(),
            readLocale: () => contextRef.current.readLocale(),
            readFullRefreshRevision: () => contextRef.current.readFullRefreshRevision(),
            load: (locale) => contextRef.current.load(locale),
            apply: (projection) => contextRef.current.apply(projection),
            onError: (reason) => contextRef.current.onError?.(reason),
          });
        }
      }),
    [],
  );
}
