import { useRef, useState } from 'react';
import type { AssetFileRevealContext, AssetFileRevealTargetDto } from '@/shared/contracts';
import {
  assetFileRevealContextFromElement,
  useAssetFileRevealContext,
} from '@/renderer/components/media/AssetFileRevealContext';

const defaultRevealContext: AssetFileRevealContext = { kind: 'ALL_MATERIALS' };

/** Resolve the owning content and load directory choices only when its menu opens. */
export function useAssetFileMenuReveal({
  assetId,
  suppliedContext,
  failedLabel,
  notify,
}: {
  assetId: string;
  suppliedContext?: AssetFileRevealContext;
  failedLabel: string;
  notify(message: string): void;
}) {
  const inheritedContext = useAssetFileRevealContext();
  const [openedContext, setOpenedContext] = useState<{
    assetId: string;
    context: AssetFileRevealContext;
  } | null>(null);
  const context =
    suppliedContext ??
    (openedContext?.assetId === assetId ? openedContext.context : inheritedContext) ??
    defaultRevealContext;
  const requestKey = `${assetId}:${JSON.stringify(context)}`;
  const latestRequestKey = useRef(requestKey);
  const requestRevision = useRef(0);
  const [targetState, setTargetState] = useState<{
    key: string;
    targets: AssetFileRevealTargetDto[];
  } | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  latestRequestKey.current = requestKey;

  function load(element: Element | null) {
    const context =
      suppliedContext ?? assetFileRevealContextFromElement(element) ?? inheritedContext ?? defaultRevealContext;
    const key = `${assetId}:${JSON.stringify(context)}`;
    latestRequestKey.current = key;
    setOpenedContext({ assetId, context });
    if ((context.kind !== 'ALL_MATERIALS' && context.kind !== 'DICTIONARY') || loadingKey === key) return;
    const revision = ++requestRevision.current;
    setTargetState(null);
    setLoadingKey(key);
    void window.desktopApi
      .assetFileRevealTargets(assetId, context)
      .then((targets) => {
        if (latestRequestKey.current === key && requestRevision.current === revision) {
          setTargetState({ key, targets });
        }
      })
      .catch((reason) => {
        if (latestRequestKey.current !== key || requestRevision.current !== revision) return;
        setTargetState({ key, targets: [] });
        notify(`${failedLabel}: ${reason instanceof Error ? reason.message : String(reason)}`);
      })
      .finally(() => {
        if (requestRevision.current === revision) {
          setLoadingKey((current) => (current === key ? null : current));
        }
      });
  }

  return {
    context,
    targets: targetState?.key === requestKey ? targetState.targets : null,
    loading: loadingKey === requestKey,
    load,
  };
}
