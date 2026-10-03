import { useEffect } from 'react';
import type { HistoryNavigationGuard } from '@/renderer/components/app/app-navigation';
import { registerWorkspaceDrain } from '@/renderer/components/workspace/workspace-drain';
import { useStableCallback } from '@/renderer/lib/useStableCallback';

interface Options {
  enabled: boolean;
  hasUnsavedInput(): boolean;
  preserve(): Promise<boolean>;
  onError(reason: unknown): void;
  onHistoryNavigationGuardChange?(guard: HistoryNavigationGuard | null): void;
}

/** A tab exit checks only this editor; application exit explicitly drains all registered editors. */
export function useCreatorNavigationProtection(options: Options) {
  const needsSave = useStableCallback(() => options.enabled && options.hasUnsavedInput());
  const preserve = useStableCallback(async () => {
    try {
      return await options.preserve();
    } catch (reason) {
      options.onError(reason);
      return false;
    }
  });
  const register = options.onHistoryNavigationGuardChange;
  useEffect(() => {
    if (!options.enabled || !register) return;
    const guard: HistoryNavigationGuard = (_direction, proceed) => {
      if (!needsSave()) return false;
      void preserve().then((saved) => {
        if (saved) proceed();
      });
      return true;
    };
    register(guard);
    return () => register(null);
  }, [options.enabled, register, needsSave, preserve]);
  useEffect(() => {
    if (!options.enabled) return;
    return registerWorkspaceDrain(async () => {
      if (needsSave() && !(await preserve())) throw new Error('CREATION_DRAFT_EXIT_BLOCKED');
    });
  }, [options.enabled, needsSave, preserve]);
}
