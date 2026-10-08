import { useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import type { BrowserCompanionTarget } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { ArticleDeliveryPresetEditor } from '@/renderer/components/creator/article-editor/ArticleDeliveryPresetEditor';
import { useI18n } from '@/renderer/i18n/useI18n';
import { readArticleDeliveryPresets } from '@/renderer/features/article-delivery/articleDeliveryPresets';
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
  const [presets, setPresets] = useState(readArticleDeliveryPresets);
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
    <div className="flex flex-wrap items-center gap-1 px-4 pb-3">
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) setPresets(readArticleDeliveryPresets());
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={disabled}>
            {copy.sources.DEFAULT}
            <ChevronDownIcon className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => onChange(readDefaultArticleDeliveryPreferences())}>
            {copy.useDefault}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {presets.map((preset) => (
            <DropdownMenuItem key={preset.name} onSelect={() => onChange(preset.preferences)}>
              <span className="max-w-64 truncate">{preset.name}</span>
            </DropdownMenuItem>
          ))}
          {presets.length > 0 && <DropdownMenuSeparator />}
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
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
      <ArticleDeliveryPresetEditor disabled={disabled} preferences={preferences} notify={notify} />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() =>
          notify(saveDefaultArticleDeliveryPreferences(preferences) ? copy.defaultSaved : copy.preferenceFailed)
        }
      >
        {copy.saveDefault}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled || !preferences.targets.length}
        onClick={() => onChange({ ...preferences, targets: [] })}
      >
        {copy.clear}
      </Button>
    </div>
  );
}
