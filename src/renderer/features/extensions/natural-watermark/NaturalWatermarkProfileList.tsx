import { CopyIcon, ImageIcon, PlusIcon, StarIcon, Trash2Icon } from 'lucide-react';
import {
  NATURAL_WATERMARK_MAX_PROFILES,
  type NaturalWatermarkConfiguration,
} from '@/shared/contracts/natural-watermark';
import { Button } from '@/renderer/components/ui/button';
import { cn } from '@/renderer/lib/utils';

export function NaturalWatermarkProfileList({
  configuration,
  selectedProfileId,
  disabled,
  zh,
  onSelect,
  onCreate,
  onPrefer,
  onDuplicate,
  onDelete,
}: {
  configuration: NaturalWatermarkConfiguration;
  selectedProfileId: string;
  disabled: boolean;
  zh: boolean;
  onSelect(profileId: string): void;
  onCreate(): void;
  onPrefer(profileId: string): void;
  onDuplicate(): void;
  onDelete(): void;
}) {
  const selectedIsPreferred = selectedProfileId === configuration.preferredProfileId;

  return (
    <div className="flex min-w-0 items-center gap-2 border-b p-2">
      <span className="shrink-0 px-1 text-sm font-semibold">{zh ? '水印方案' : 'Watermarks'}</span>
      <div
        role="listbox"
        aria-label={zh ? '水印方案' : 'Watermark profiles'}
        className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
      >
        {configuration.profiles.map((profile) => {
          const selected = profile.id === selectedProfileId;
          const preferred = profile.id === configuration.preferredProfileId;
          return (
            <button
              key={profile.id}
              type="button"
              role="option"
              aria-selected={selected}
              disabled={disabled}
              className={cn(
                'flex h-8 min-w-24 max-w-40 shrink-0 items-center gap-1.5 rounded-md px-2 text-left text-sm outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                selected && 'bg-selected font-medium text-selected-foreground hover:bg-selected',
              )}
              onClick={() => onSelect(profile.id)}
            >
              <ImageIcon className="size-3.5 shrink-0" />
              <span className="truncate">{profile.name}</span>
              {preferred && (
                <StarIcon className="ml-auto size-3 shrink-0 fill-current" aria-label={zh ? '首选' : 'Preferred'} />
              )}
            </button>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center gap-0.5 border-l pl-2">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={disabled || configuration.profiles.length >= NATURAL_WATERMARK_MAX_PROFILES}
          aria-label={zh ? '新建水印方案' : 'Create watermark'}
          title={zh ? '新建水印方案' : 'Create watermark'}
          onClick={onCreate}
        >
          <PlusIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={disabled || selectedIsPreferred}
          aria-label={
            selectedIsPreferred ? (zh ? '首选方案' : 'Preferred watermark') : zh ? '设为首选' : 'Make preferred'
          }
          title={selectedIsPreferred ? (zh ? '首选方案' : 'Preferred watermark') : zh ? '设为首选' : 'Make preferred'}
          onClick={() => onPrefer(selectedProfileId)}
        >
          <StarIcon className={cn('size-3.5', selectedIsPreferred && 'fill-current')} />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={disabled || configuration.profiles.length >= NATURAL_WATERMARK_MAX_PROFILES}
          aria-label={zh ? '复制水印方案' : 'Duplicate watermark'}
          title={zh ? '复制水印方案' : 'Duplicate watermark'}
          onClick={onDuplicate}
        >
          <CopyIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          disabled={disabled || configuration.profiles.length <= 1}
          aria-label={zh ? '删除水印方案' : 'Delete watermark'}
          title={zh ? '删除水印方案' : 'Delete watermark'}
          onClick={onDelete}
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
