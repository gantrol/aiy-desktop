import { useEffect } from 'react';
import type { Locale } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { aiyIdentityUrl } from '@/renderer/components/brand/AiyIdentity';
import github from '../../../../../../extensions/com.aiy.feature-demo/assets/v050/github.svg?url';
import ijiri from '../../../../../../extensions/com.aiy.feature-demo/assets/v050/paper-reference.svg?url';
import storeEnglish from '../../../../../../extensions/com.aiy.feature-demo/assets/v050/microsoft-store-en-us.svg?url';
import storeChinese from '../../../../../../extensions/com.aiy.feature-demo/assets/v050/microsoft-store-zh-cn.svg?url';
import tray from '../../../../../../build/taskbar-icon.svg?url';

export const demoOutroMedia = { github, ijiri, identity: aiyIdentityUrl, tray };
export const demoStoreBadges: Record<Locale, string> = { en: storeEnglish, zh: storeChinese };

/** Five bounded, local assets preload during the existing animation segment. */
export function useDemoOutroMedia(onReady: (ready: boolean) => void, onError: () => void) {
  const { locale } = useI18n();
  useEffect(() => {
    let live = true;
    const images = [...Object.values(demoOutroMedia), demoStoreBadges[locale]].map((source) => {
      const image = new Image();
      image.src = source;
      return image;
    });
    void Promise.all(images.map((image) => image.decode())).then(
      () => {
        if (live) onReady(true);
      },
      () => {
        if (live) onError();
      },
    );
    return () => {
      live = false;
    };
  }, [onReady, onError, locale]);
}
