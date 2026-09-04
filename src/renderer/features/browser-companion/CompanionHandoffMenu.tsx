import { ChevronDownIcon, CloudUploadIcon, LoaderCircleIcon } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { CompanionDestinationSettingsSubmenu } from '@/renderer/features/browser-companion/CompanionDestinationMenu';
import { CompanionWatermarkSubmenu } from '@/renderer/features/browser-companion/CompanionWatermarkMenu';
import type { BrowserCompanionTarget, BrowserCompanionWatermarkSelection } from '@/shared/contracts';

const TARGET_LABELS: Record<BrowserCompanionTarget, { en: string; zh: string }> = {
  chatgpt: { en: 'ChatGPT', zh: 'ChatGPT' },
  wechat: { en: 'WeChat Official Account', zh: '微信公众号' },
  weibo: { en: 'Weibo', zh: '微博' },
};

export function CompanionHandoffMenu({
  busy,
  disabled,
  onHandoff,
  targets,
  variant = 'default',
  watermarkAvailable,
  zh,
}: {
  busy: boolean;
  disabled: boolean;
  onHandoff(target: BrowserCompanionTarget, watermark: BrowserCompanionWatermarkSelection): void;
  targets: readonly BrowserCompanionTarget[];
  variant?: ComponentProps<typeof Button>['variant'];
  watermarkAvailable: boolean;
  zh: boolean;
}) {
  const [watermark, setWatermark] = useState<BrowserCompanionWatermarkSelection>({ kind: 'NONE' });
  const label = busy
    ? zh
      ? '上传中'
      : 'Uploading'
    : watermarkAvailable
      ? `${zh ? '上传' : 'Upload'} · ${watermark.kind === 'NONE' ? (zh ? '无水印' : 'No watermark') : zh ? '水印' : 'Watermark'}`
      : zh
        ? '上传'
        : 'Upload';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          data-action="content-upload"
          variant={variant}
          size="sm"
          disabled={disabled || targets.length === 0}
          aria-busy={busy || undefined}
        >
          {busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <CloudUploadIcon className="size-4" />}
          {label}
          <ChevronDownIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {targets.map((target) => (
          <DropdownMenuItem
            key={target}
            data-browser-companion-target={target}
            disabled={busy}
            onSelect={() => onHandoff(target, watermarkAvailable ? watermark : { kind: 'NONE' })}
          >
            <DropdownMenuIcon>
              <CloudUploadIcon />
            </DropdownMenuIcon>
            {TARGET_LABELS[target][zh ? 'zh' : 'en']}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {watermarkAvailable && (
          <>
            <CompanionWatermarkSubmenu busy={busy} selection={watermark} zh={zh} onSelectionChange={setWatermark} />
            <DropdownMenuSeparator />
          </>
        )}
        <CompanionDestinationSettingsSubmenu busy={busy} targets={targets} zh={zh} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
