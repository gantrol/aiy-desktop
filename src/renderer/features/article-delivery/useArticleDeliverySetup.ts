import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserCompanionDestinationsResult } from '@/shared/contracts';
import type { ArticleDeliveryStatus } from '@/shared/contracts/article-delivery';
import { articleUploadTargetKey } from '@/renderer/features/article-delivery/articleDeliveryPreferences';
import {
  articleDeliveryTargetChoice,
  type ArticleDeliveryTarget,
} from '@/renderer/features/article-delivery/articleDeliveryTargets';

export interface ArticleDeliveryProfileDraft {
  slug: string;
  description: string;
}

export interface ArticleDeliverySetupEntry {
  status?: ArticleDeliveryStatus;
  error?: unknown;
}

export function useArticleDeliverySetup({
  articleId,
  spaceId,
  targets,
}: {
  articleId: string;
  spaceId: string;
  targets: readonly ArticleDeliveryTarget[];
}) {
  const [entries, setEntries] = useState<Record<string, ArticleDeliverySetupEntry>>({});
  const [destinations, setDestinations] = useState<BrowserCompanionDestinationsResult | null>(null);
  const [browserFailed, setBrowserFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const requests = useRef({ version: 0, active: true });

  const refresh = useCallback(async () => {
    const lifecycle = requests.current;
    const version = ++lifecycle.version;
    const current = () => lifecycle.active && lifecycle.version === version;
    setLoading(true);
    setBrowserFailed(false);
    const active = targets.filter((target) => target.activated);
    let index = 0;
    const loaded: Record<string, ArticleDeliverySetupEntry> = {};
    async function loadTargets() {
      while (current()) {
        const target = active[index++];
        if (!target) return;
        const key = articleUploadTargetKey(articleDeliveryTargetChoice(target));
        try {
          const status = await window.desktopApi.articleDeliveryStatus({
            extensionId: target.extensionId,
            channelId: target.channelId,
            articleId,
            spaceId,
          });
          loaded[key] = { status };
        } catch (error) {
          loaded[key] = { error };
        }
      }
    }
    async function loadDestinations() {
      try {
        const result = await window.desktopApi.browserCompanionDestinations();
        if (current()) setDestinations(result);
      } catch {
        if (current()) {
          setDestinations(null);
          setBrowserFailed(true);
        }
      }
    }
    // The open dialog is the only consumer. At most two local API channel reads
    // run alongside the single browser-profile inventory request.
    await Promise.all([loadTargets(), loadTargets(), loadDestinations()]);
    if (current()) {
      setEntries(loaded);
      setLoading(false);
    }
  }, [articleId, spaceId, targets]);

  useEffect(() => {
    const lifecycle = requests.current;
    lifecycle.active = true;
    void refresh();
    return () => {
      lifecycle.active = false;
      lifecycle.version++;
    };
  }, [refresh]);

  return { entries, destinations, setDestinations, browserFailed, loading, refresh };
}
