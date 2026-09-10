import { z } from 'zod';
import { WECHAT_SOCIAL_POST, WECHAT_ARTICLE } from '@/lib/composer-adapters/wechat-config';

export const wechatNavigationRequestSchema = z
  .object({
    kind: z.literal('open-wechat-social-post'),
    handoffId: z.string().uuid(),
    contentKind: z.enum(['social-post-body', 'article-body']).default('social-post-body'),
  })
  .strict();

export async function openWechatSocialPost(
  tabId: number,
  handoffId: string,
  contentKind: 'social-post-body' | 'article-body' = 'social-post-body',
): Promise<boolean> {
  const results = await browser.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    world: 'MAIN',
    args: [contentKind === 'article-body' ? WECHAT_ARTICLE : WECHAT_SOCIAL_POST, handoffId, contentKind],
    func: (config: typeof WECHAT_SOCIAL_POST | typeof WECHAT_ARTICLE, pendingId: string, kind: string) => {
      if (window.location.origin !== config.origin) return false;
      const entries = [...document.querySelectorAll<HTMLElement>(config.menuContent)].filter((element) => {
        const bounds = element.getBoundingClientRect();
        return element.innerText.trim() === config.menuLabel && bounds.width > 0 && bounds.height > 0;
      });
      const entry = entries.length === 1 ? entries[0] : null;
      if (!entry) return false;

      // The site's click handler opens a named popup. Keep this one navigation
      // in the handoff tab so popup blocking/reuse cannot lose its identity.
      const originalOpen = window.open;
      let destination: URL | null = null;
      window.open = (url) => {
        if (!url) return null;
        const candidate = new URL(String(url), window.location.href);
        const type = candidate.searchParams.get('type');
        const createType = candidate.searchParams.get('createType');
        if (
          candidate.origin !== config.origin ||
          candidate.pathname !== config.editorPath ||
          !(
            (type === config.editorType && createType === config.editorCreateType) ||
            (createType === null && type === config.legacyEditorType)
          )
        )
          return null;
        destination = candidate;
        return window;
      };
      try {
        entry.click();
      } finally {
        window.open = originalOpen;
      }
      if (!destination) return false;
      const target = new URL(String(destination));
      target.hash = new URLSearchParams({
        'aiy-handoff': pendingId,
        'aiy-content': kind,
      }).toString();
      window.location.assign(target.href);
      return true;
    },
  });
  return results.some((result) => result.frameId === 0 && result.result === true);
}
