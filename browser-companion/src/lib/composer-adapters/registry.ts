import type { CompanionSite } from '@/lib/protocol';
import type { ComposerAdapter } from '@/lib/composer-adapters/contract';
import { chatGptComposerAdapter } from '@/lib/composer-adapters/chatgpt';
import { wechatComposerAdapter } from '@/lib/composer-adapters/wechat';
import { wechatArticleComposerAdapter } from '@/lib/composer-adapters/wechat-article';
import { weiboComposerAdapter } from '@/lib/composer-adapters/weibo';
import { xComposerAdapter } from '@/lib/composer-adapters/x';
import { xiaohongshuComposerAdapter } from '@/lib/composer-adapters/xiaohongshu';

const adapters: Record<CompanionSite, ComposerAdapter> = {
  chatgpt: chatGptComposerAdapter,
  wechat: wechatComposerAdapter,
  weibo: weiboComposerAdapter,
  x: xComposerAdapter,
  xiaohongshu: xiaohongshuComposerAdapter,
};

export function composerAdapter(site: CompanionSite, contentKind?: string): ComposerAdapter {
  if (site === 'wechat' && contentKind === 'article-body') return wechatArticleComposerAdapter;
  return adapters[site];
}
