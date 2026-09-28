import { MoreHorizontalIcon } from 'lucide-react';
import type { BrowserCompanionTarget } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  readDefaultArticleDeliveryPreferences,
  saveDefaultArticleDeliveryPreferences,
  type ArticleDeliveryPreferences,
  type ArticleUploadTarget,
} from '@/renderer/features/article-delivery/articleDeliveryPreferences';

export function ArticleDeliveryPresetMenu({
  disabled,
  loading,
  preferences,
  configured,
  selectable,
  onChange,
  notify,
}: {
  disabled: boolean;
  loading: boolean;
  preferences: ArticleDeliveryPreferences;
  configured: ArticleUploadTarget[];
  selectable: ArticleUploadTarget[];
  onChange(preferences: ArticleDeliveryPreferences): void;
  notify(message: string): void;
}) {
  const copy = useI18n().messages.articleDelivery.batch;
  function hasTargets(targets: readonly BrowserCompanionTarget[]) {
    return targets.every((target) =>
      configured.some((choice) => choice.kind === 'BROWSER' && choice.target === target),
    );
  }
  function selectPreset(targets: ('wechat' | 'xiaohongshu' | 'weibo' | 'x')[]) {
    onChange({
      version: 2,
      targets: targets.map((target) =>
        target === 'wechat' ? { kind: 'BROWSER', target, mode: 'article' } : { kind: 'BROWSER', target },
      ),
    });
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={copy.sources.DEFAULT}>
          <MoreHorizontalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onChange(readDefaultArticleDeliveryPreferences())}>
          {copy.useDefault}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            notify(saveDefaultArticleDeliveryPreferences(preferences) ? copy.defaultSaved : copy.preferenceFailed)
          }
        >
          {copy.saveDefault}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>{copy.categories}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem
              disabled={!hasTargets(['wechat', 'xiaohongshu'])}
              onSelect={() => selectPreset(['wechat', 'xiaohongshu'])}
            >
              {copy.presetWechatXhs}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!hasTargets(['weibo', 'x'])} onSelect={() => selectPreset(['weibo', 'x'])}>
              {copy.presetWeiboX}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={loading} onSelect={() => onChange({ ...preferences, targets: selectable })}>
              {copy.selectAll}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onChange({ ...preferences, targets: [] })}>
              {copy.deselectAll}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
