import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { useI18n } from '@/renderer/i18n/useI18n';

/** Both forms stay visible before selecting the platform. Picking a form does not select a target. */
export function WechatPublicationMode({
  value,
  disabled,
  onValueChange,
}: {
  value: 'article' | 'images';
  disabled?: boolean;
  onValueChange(value: 'article' | 'images'): void;
}) {
  const { messages } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs text-muted-foreground">{messages.publishing.wechatMode}</span>
      <Segmented
        type="single"
        data-publication-wechat-mode
        aria-label={messages.publishing.wechatMode}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === 'article' || next === 'images') onValueChange(next);
        }}
      >
        <SegmentedItem value="article">{messages.browserCompanion.articleUpload}</SegmentedItem>
        <SegmentedItem value="images">{messages.browserCompanion.imagePostUpload}</SegmentedItem>
      </Segmented>
    </div>
  );
}
