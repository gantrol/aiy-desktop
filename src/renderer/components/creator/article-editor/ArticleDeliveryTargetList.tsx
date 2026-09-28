import type { ReactNode } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import type {
  ArticleUploadTarget,
  ArticleDeliveryPreferences,
} from '@/renderer/features/article-delivery/articleDeliveryPreferences';
import { ArticleDeliverySelectAll } from '@/renderer/components/creator/article-editor/ArticleDeliverySelection';
import { ArticleDeliveryBrand } from '@/renderer/components/creator/article-editor/ArticleDeliveryBrand';

export function ArticleDeliveryTargetList({
  choices,
  renderChoice,
  preferences,
  groupTargets,
  disabled,
  onSelect,
}: {
  choices: readonly ArticleUploadTarget[];
  renderChoice(choice: ArticleUploadTarget): ReactNode;
  preferences: ArticleDeliveryPreferences;
  groupTargets: readonly ArticleUploadTarget[];
  disabled: boolean;
  onSelect(targets: readonly ArticleUploadTarget[], selected: boolean): void;
}) {
  const { messages } = useI18n();
  const companionCopy = messages.browserCompanion;
  const publishingCopy = messages.publishing;
  return (
    <div className="divide-y divide-border" aria-label={publishingCopy.channels}>
      <div className="py-1">
        <ArticleDeliverySelectAll
          label={messages.articleDelivery.batch.allPlatforms}
          targets={groupTargets}
          preferences={preferences}
          disabled={disabled}
          onChange={onSelect}
        />
      </div>
      <div className="py-2" role="group" aria-label={companionCopy.targets.wechat}>
        <div className="flex items-center gap-3 text-sm font-medium">
          <ArticleDeliveryBrand brand="wechat" />
          <span className="min-w-0 flex-1">{companionCopy.targets.wechat}</span>
          <ArticleDeliverySelectAll
            label={messages.articleDelivery.batch.selectAllWechat}
            showLabel={false}
            targets={groupTargets.filter((choice) => choice.kind === 'BROWSER' && choice.target === 'wechat')}
            preferences={preferences}
            disabled={disabled}
            onChange={onSelect}
          />
        </div>
        <div className="grid grid-cols-2 gap-x-4 pl-9">
          {choices.filter((choice) => choice.kind === 'BROWSER' && choice.target === 'wechat').map(renderChoice)}
        </div>
      </div>
      {choices.filter((choice) => choice.kind !== 'BROWSER' || choice.target !== 'wechat').map(renderChoice)}
    </div>
  );
}
