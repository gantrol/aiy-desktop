export const COMPOSER_CONTENT_SCRIPT_OPTIONS = {
  matches: [
    'https://chatgpt.com/*',
    'https://mp.weixin.qq.com/*',
    'https://weibo.com/*',
    'https://www.weibo.com/*',
    'https://x.com/*',
    'https://twitter.com/*',
    'https://creator.xiaohongshu.com/*',
  ],
  allFrames: true,
  runAt: 'document_start' as const,
};

export async function registerDevelopmentComposer(): Promise<void> {
  if (import.meta.env.COMMAND !== 'serve') return;
  // WXT 0.21 registers MV3 scripts after its dev WebSocket connects. Use the
  // same ID locally so cold starts work offline and WXT can still update it.
  const script = {
    id: 'wxt:content-scripts/composer.js',
    js: ['content-scripts/composer.js'],
    matches: [...COMPOSER_CONTENT_SCRIPT_OPTIONS.matches],
    allFrames: COMPOSER_CONTENT_SCRIPT_OPTIONS.allFrames,
    runAt: COMPOSER_CONTENT_SCRIPT_OPTIONS.runAt,
    persistAcrossSessions: true,
  };
  const existing = await browser.scripting.getRegisteredContentScripts({ ids: [script.id] });
  if (existing.length) await browser.scripting.updateContentScripts([script]);
  else await browser.scripting.registerContentScripts([script]);
}
