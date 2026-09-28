import { PlugIcon } from 'lucide-react';
import wechat from '@/renderer/assets/brands/wechat.png';
import xiaohongshu from '@/renderer/assets/brands/xiaohongshu.png';
import weibo from '@/renderer/assets/brands/weibo.png';
import x from '@/renderer/assets/brands/x.png';
import aicando from '@/renderer/assets/brands/aicando.png';

const brands: Readonly<Record<string, string>> = {
  wechat,
  xiaohongshu,
  weibo,
  x,
  'com.aiy.channel.aicando': aicando,
};

export function ArticleDeliveryBrand({ brand }: { brand: string }) {
  const source = brands[brand];
  return (
    <span className="flex size-6 shrink-0 items-center justify-center" aria-hidden="true">
      {source ? (
        <img
          src={source}
          alt=""
          className={`size-6 object-contain ${brand === 'x' ? 'rounded-sm bg-media-surround-dark p-1' : brand === 'xiaohongshu' ? 'dark:invert' : ''}`}
        />
      ) : (
        <PlugIcon className="size-5 text-muted-foreground" />
      )}
    </span>
  );
}
