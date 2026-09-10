import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { DemoTarget, DemoWindowDetail } from '@/renderer/features/extensions/feature-demo/v050/demoProtocol';
import { demoCues } from '@/renderer/features/extensions/feature-demo/v050/demoTimeline';

/** The scripted cursor follows native component geometry, including localized menu sizes. */
export function useDemoWorkspaceTargets(time: number, notify: (message: DemoWindowDetail) => void) {
  const { messages } = useI18n();
  const openLabel = messages.desktopPetals.menu.openMain;
  const sent = useRef(new Map<DemoTarget, string>());
  const ready = useRef(false);
  const currentTime = useRef(time);
  currentTime.current = time;
  // Hidden subframes may defer animation frames. Readiness must use load/DOM events directly.
  const checkReady = useCallback(() => {
    if (ready.current || !document.querySelector('[data-generation-prompt]')) return;
    const source = document.querySelector<HTMLImageElement>('[data-demo-media="source"]');
    const result = document.querySelector<HTMLImageElement>('[data-demo-media="result"]');
    const identities = [...document.querySelectorAll<HTMLImageElement>('[data-aiy-identity]')];
    if (source && result && [source, result, ...identities].every((image) => image.complete && image.naturalWidth)) {
      ready.current = true;
      notify({ type: 'ready' });
    }
  }, [notify]);
  const measure = useCallback(() => {
    const menu = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (element) => element.textContent?.trim() === openLabel,
    );
    // Opening while paused also applies hover after the real menu portal finishes mounting.
    menu?.toggleAttribute(
      'data-highlighted',
      currentTime.current >= demoCues.menuHover && currentTime.current < demoCues.openMain,
    );
    const prompt = document.querySelector<HTMLElement>('[data-generation-prompt]');
    const targets: Partial<Record<DemoTarget, HTMLElement | null>> = {
      openMain: menu,
      prompt,
      generate: document.querySelector<HTMLElement>('[data-action="generate"]'),
      result: document.querySelector<HTMLElement>('[data-demo-result]'),
      magnify: document.querySelector<HTMLElement>('[data-demo-magnify]'),
      variant: document.querySelector<HTMLElement>('[data-action="make-variant"]'),
      gif: document.querySelector<HTMLElement>('[data-action="new-animation-variant"]'),
      motionPrompt: document.querySelector<HTMLElement>('[data-control="gif-motion-prompt"]'),
      motionPlan: document.querySelector<HTMLElement>('[data-action="gif-propose-plan"]'),
      motionConfirm: document.querySelector<HTMLElement>('[data-action="gif-confirm-generate"]'),
      motionFrame: document.querySelector<HTMLElement>('[data-gif-frame-id="demo-smile-frame-5"]'),
      motionPlay: document.querySelector<HTMLElement>('[data-demo-smile-play]'),
      motionFace: document.querySelector<HTMLElement>('[data-demo-smile-canvas] canvas'),
    };
    for (const [name, element] of Object.entries(targets)) {
      if (!element) continue;
      const bounds = element.getBoundingClientRect();
      if (!bounds.width || !bounds.height || bounds.x < 0 || bounds.y < 0) continue;
      const target = name as DemoTarget;
      const point: [number, number] =
        target === 'motionFace'
          ? [bounds.left + bounds.width * 0.6, bounds.top + bounds.height * 0.17]
          : target === 'prompt' || target === 'motionPrompt'
            ? [bounds.left + 24, bounds.top + 24]
            : [bounds.left + bounds.width / 2, bounds.top + bounds.height / 2];
      const signature = point.join(',');
      if (sent.current.get(target) === signature) continue;
      sent.current.set(target, signature);
      notify({ type: 'target', target, point });
    }
    document
      .querySelector('[data-action="new-animation-variant"]')
      ?.toggleAttribute(
        'data-highlighted',
        currentTime.current >= demoCues.gifHover && currentTime.current < demoCues.gifOpen,
      );
  }, [notify, openLabel]);

  useEffect(() => {
    let frame = 0;
    let live = true;
    const schedule = () => {
      if (!live) return;
      checkReady();
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    const size = new ResizeObserver(schedule);
    size.observe(document.body);
    document.addEventListener('load', schedule, true);
    void document.fonts.ready.then(schedule);
    schedule();
    return () => {
      live = false;
      cancelAnimationFrame(frame);
      mutations.disconnect();
      size.disconnect();
      document.removeEventListener('load', schedule, true);
    };
  }, [measure, checkReady]);

  useLayoutEffect(() => {
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
      (element) => element.textContent?.trim() === openLabel,
    );
    item?.toggleAttribute('data-highlighted', time >= demoCues.menuHover && time < demoCues.openMain);
    document
      .querySelector('[data-action="new-animation-variant"]')
      ?.toggleAttribute('data-highlighted', time >= demoCues.gifHover && time < demoCues.gifOpen);
  }, [time, openLabel]);
}
