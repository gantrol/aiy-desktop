import { useState } from 'react';
import {
  CheckIcon,
  CirclePlayIcon,
  FileTextIcon,
  ImageIcon,
  ImagesIcon,
  LoaderCircleIcon,
  PresentationIcon,
  VideoIcon,
} from 'lucide-react';
import type { Locale } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { cn } from '@/renderer/lib/utils';

export type CreationOutcomeKind = 'image' | 'social-graphic' | 'document' | 'presentation';

type SocialGraphicIntent = 'share' | 'note' | 'promotion';
type SocialPlatform = 'weibo' | 'wechat' | 'xiaohongshu';

interface Props {
  locale: Locale;
  value: CreationOutcomeKind[];
  onValueChange(value: CreationOutcomeKind[]): void;
  onChooseVideoDocument(): void;
}

interface PlannerProps {
  locale: Locale;
  startReady: boolean;
  starting: boolean;
  onStartCreation(): void;
  onChooseVideoDocument(): void;
}

const outcomeIcons = {
  image: ImageIcon,
  'social-graphic': ImagesIcon,
  document: FileTextIcon,
  presentation: PresentationIcon,
} satisfies Record<CreationOutcomeKind, typeof ImageIcon>;

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export function CreationOutcomePicker({ locale, value, onValueChange, onChooseVideoDocument }: Props) {
  const zh = locale === 'zh';
  const [socialIntent, setSocialIntent] = useState<SocialGraphicIntent>('share');
  const [socialPlatforms, setSocialPlatforms] = useState<SocialPlatform[]>(['wechat']);
  const outcomes: Array<{ kind: CreationOutcomeKind; label: string; available: boolean }> = [
    { kind: 'image', label: zh ? '图片' : 'Image', available: true },
    { kind: 'social-graphic', label: zh ? '贴图' : 'Social graphic', available: false },
    { kind: 'document', label: zh ? '文稿' : 'Document', available: true },
    { kind: 'presentation', label: zh ? '演示文稿' : 'Presentation', available: false },
  ];
  const socialIntents: Array<{ value: SocialGraphicIntent; label: string }> = [
    { value: 'share', label: zh ? '分享' : 'Share' },
    { value: 'note', label: zh ? '笔记' : 'Note' },
    { value: 'promotion', label: zh ? '宣传' : 'Promote' },
  ];
  const platforms: Array<{ value: SocialPlatform; label: string }> = [
    { value: 'weibo', label: zh ? '微博' : 'Weibo' },
    { value: 'wechat', label: zh ? '公众号' : 'WeChat' },
    { value: 'xiaohongshu', label: zh ? '小红书' : 'RED' },
  ];

  function toggleOutcome(kind: CreationOutcomeKind) {
    onValueChange(toggleValue(value, kind));
  }

  return (
    <section data-creation-outcomes className="mt-5 flex flex-col gap-3">
      <div className="flex h-7 items-center justify-between gap-3">
        <span className="text-sm font-semibold">{zh ? '这次要做' : 'Create'}</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {zh ? `已选 ${value.length} 项` : `${value.length} selected`}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {outcomes.map((outcome) => {
          const selectedIndex = value.indexOf(outcome.kind);
          const selected = selectedIndex >= 0;
          const Icon = outcomeIcons[outcome.kind];
          const roleLabel = selectedIndex === 0 ? (zh ? '主成果' : 'Primary') : zh ? '配套' : 'Companion';
          const availabilityLabel = outcome.available ? (zh ? '可用' : 'Available') : zh ? '待接入' : 'Planned';
          return (
            <Button
              key={outcome.kind}
              type="button"
              variant="outline"
              disabled={!outcome.available}
              aria-pressed={selected}
              title={!outcome.available ? (zh ? '待接入' : 'Planned') : undefined}
              className={cn(
                'h-auto min-h-16 justify-start gap-2.5 whitespace-normal px-3 py-2.5 text-left',
                selected && 'border-selected-border bg-selected text-selected-foreground hover:bg-selected',
              )}
              onClick={() => toggleOutcome(outcome.kind)}
            >
              <Icon className="size-4" />
              <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                <span className="font-semibold">{outcome.label}</span>
                <span className="text-2xs font-normal text-muted-foreground">
                  {selected ? `${roleLabel} · ${availabilityLabel}` : availabilityLabel}
                </span>
              </span>
              {selected && <CheckIcon className="size-3.5" />}
            </Button>
          );
        })}
      </div>

      {value.includes('document') && (
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="w-12 shrink-0 text-xs font-medium text-foreground-secondary">{zh ? '流程' : 'Flow'}</span>
          <Button type="button" variant="outline" size="sm" onClick={onChooseVideoDocument}>
            <VideoIcon className="size-4" />
            {zh ? '视频转文稿' : 'Video to document'}
          </Button>
        </div>
      )}

      {value.includes('social-graphic') && (
        <div className="grid gap-2 border-t pt-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
          <span className="w-12 shrink-0 text-xs font-medium text-foreground-secondary">{zh ? '用途' : 'Intent'}</span>
          <Segmented
            type="single"
            value={socialIntent}
            onValueChange={(next) => next && setSocialIntent(next as SocialGraphicIntent)}
            aria-label={zh ? '贴图用途' : 'Social graphic intent'}
          >
            {socialIntents.map((item) => (
              <SegmentedItem key={item.value} value={item.value}>
                {item.label}
              </SegmentedItem>
            ))}
          </Segmented>
          <span className="w-12 shrink-0 text-xs font-medium text-foreground-secondary">
            {zh ? '平台' : 'Platform'}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {platforms.map((platform) => {
              const selected = socialPlatforms.includes(platform.value);
              return (
                <Button
                  key={platform.value}
                  type="button"
                  variant="outline"
                  size="xs"
                  aria-pressed={selected}
                  className={cn(
                    selected && 'border-selected-border bg-selected text-selected-foreground hover:bg-selected',
                  )}
                  onClick={() => setSocialPlatforms((current) => toggleValue(current, platform.value))}
                >
                  {selected && <CheckIcon className="size-3" />}
                  {platform.label}
                </Button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function CreationOutcomePlanner({
  locale,
  startReady,
  starting,
  onStartCreation,
  onChooseVideoDocument,
}: PlannerProps) {
  const [outcomes, setOutcomes] = useState<CreationOutcomeKind[]>([]);
  const unavailableOutcomes = outcomes.filter((outcome) => outcome === 'social-graphic' || outcome === 'presentation');
  const documentSelected = outcomes.includes('document');
  const canStartCreation = startReady && outcomes.length === 1 && outcomes[0] === 'image' && !starting;
  const blockedTitle =
    outcomes.length === 0
      ? locale === 'zh'
        ? '请选择成果'
        : 'Choose a result'
      : unavailableOutcomes.length
        ? locale === 'zh'
          ? '所选成果尚未接入'
          : 'Some selected results are not available yet'
        : documentSelected
          ? locale === 'zh'
            ? '请先在文稿流程中选择视频'
            : 'Choose a video from the document flow first'
          : '';

  return (
    <>
      <CreationOutcomePicker
        locale={locale}
        value={outcomes}
        onValueChange={setOutcomes}
        onChooseVideoDocument={onChooseVideoDocument}
      />
      <div className="mt-4 flex min-h-10 items-center justify-end border-t pt-4">
        <Button
          data-action="start-creation"
          type="button"
          size="lg"
          disabled={!canStartCreation}
          title={blockedTitle}
          aria-busy={starting}
          onClick={onStartCreation}
        >
          {starting ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CirclePlayIcon className="size-4" />}
          {locale === 'zh' ? '开启创作' : 'Start creating'}
          {outcomes.length > 1 ? ` · ${outcomes.length}` : ''}
        </Button>
      </div>
    </>
  );
}
