import { useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import type { GifAdoptionTarget } from '@/shared/contracts/gif-making';
import { useI18n } from '@/renderer/i18n/useI18n';

export function GifAdoptionAction({
  assetId,
  target,
  spaceId,
  refresh,
}: {
  assetId: string;
  target: GifAdoptionTarget;
  spaceId: string;
  refresh(): Promise<void>;
}) {
  const labels = useI18n().messages.creator.gifMaker;
  const request = useRef(crypto.randomUUID());
  const [state, setState] = useState<'idle' | 'busy' | 'adopted' | 'conflict' | 'failed'>('idle');
  const lock = useRef(false);
  const adopt = async () => {
    if (lock.current || state === 'adopted' || state === 'conflict') return;
    lock.current = true;
    setState('busy');
    try {
      const result = await window.desktopApi.derivedVisualAdopt({
        id: target.visualId,
        requestId: request.current,
        spaceId,
        imageAssetId: assetId,
        expectedRevisionId: target.expectedRevisionId,
        intent: target.intent,
      });
      setState(result.status === 'SUCCEEDED' ? 'adopted' : result.status === 'CONFLICT' ? 'conflict' : 'failed');
      await refresh();
    } catch {
      setState('failed');
    } finally {
      lock.current = false;
    }
  };
  return (
    <div className="flex items-center gap-2">
      {(state === 'conflict' || state === 'failed') && (
        <span role="alert" className="text-xs text-destructive">
          {state === 'conflict' ? labels.adoptionConflict : labels.adoptionFailed}
        </span>
      )}
      <Button
        size="sm"
        variant="outline"
        title={target.title}
        disabled={state === 'busy' || state === 'adopted' || state === 'conflict'}
        onClick={() => void adopt()}
      >
        {state === 'adopted'
          ? labels.adopted
          : target.intent === 'SET_COVER'
            ? labels.useAsCover
            : labels.useAsIllustration}
      </Button>
    </div>
  );
}
