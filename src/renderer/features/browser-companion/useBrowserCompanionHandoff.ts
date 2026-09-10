import { useI18n } from '@/renderer/i18n/useI18n';
import { browserCompanionStageErrorCodeSchema } from '@/shared/contracts/browser-companion';
import { useRef, useState } from 'react';
import type {
  BrowserCompanionStageInput,
  BrowserCompanionTarget,
  BrowserCompanionWatermarkSelection,
} from '@/shared/contracts';

type PreparedHandoff = Omit<BrowserCompanionStageInput, 'target' | 'watermark'>;

export function useBrowserCompanionHandoff({
  notify,
  prepare,
}: {
  notify(message: string): void;
  prepare(target: BrowserCompanionTarget): Promise<PreparedHandoff | null>;
  zh?: boolean;
}) {
  const copy = useI18n().messages.browserCompanion;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);

  async function handoff(
    target: BrowserCompanionTarget,
    watermark?: BrowserCompanionWatermarkSelection,
  ): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const prepared = await prepare(target);
      if (!prepared) return;
      const result = await window.desktopApi.browserCompanionStage({
        target,
        ...prepared,
        ...(watermark ? { watermark } : {}),
      });
      notify(
        result.browserOpened
          ? copy.opened[target]
          : result.browserOpenError
            ? `${copy.openErrors[result.browserOpenError]} · ${copy.saved}`
            : copy.savedWithoutBrowser,
      );
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      const code = browserCompanionStageErrorCodeSchema.safeParse(message);
      notify(code.success ? copy.stageErrors[code.data] : message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return { busy, handoff };
}
