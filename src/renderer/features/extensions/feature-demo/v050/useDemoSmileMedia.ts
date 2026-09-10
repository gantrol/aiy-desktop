import { useEffect, useRef, useState } from 'react';
import { demoSmileImages } from '@/renderer/features/extensions/feature-demo/v050/demoMedia';
import type { DemoWindowDetail } from '@/renderer/features/extensions/feature-demo/v050/demoProtocol';

/** Delay full-resolution frame decoding until GIF setup; keep at most two loads in flight. */
export function useDemoSmileMedia(enabled: boolean, notify: (message: DemoWindowDetail) => void) {
  const [requested, setRequested] = useState(false);
  const [ready, setReady] = useState(false);
  const decoded = useRef<HTMLImageElement[]>([]);
  useEffect(() => {
    if (enabled) setRequested(true);
  }, [enabled]);
  useEffect(() => {
    if (!requested) return;
    let live = true;
    let next = 0;
    const load = async () => {
      while (live && next < demoSmileImages.length) {
        const index = next++;
        const image = new Image();
        image.src = demoSmileImages[index];
        await image.decode();
        if (image.naturalWidth !== 1024 || image.naturalHeight !== 1536) throw new Error('DEMO_FRAME_SIZE');
        if (live) decoded.current[index] = image;
      }
    };
    void Promise.all([load(), load()])
      .then(() => {
        if (!live) return;
        setReady(true);
        notify({ type: 'motion-ready' });
      })
      .catch(() => {
        if (!live) return;
        live = false;
        decoded.current = [];
        notify({ type: 'failed' });
      });
    return () => {
      live = false;
      decoded.current = [];
    };
  }, [notify, requested]);
  return ready;
}
