import { ChevronDownIcon, CloudUploadIcon, LoaderCircleIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
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
import type { BrowserCompanionTarget } from '@/shared/contracts';

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
  zh,
}: {
  busy: boolean;
  disabled: boolean;
  onHandoff(target: BrowserCompanionTarget): void;
  targets: readonly BrowserCompanionTarget[];
  variant?: ComponentProps<typeof Button>['variant'];
  zh: boolean;
}) {
  const label = busy ? (zh ? '上传中' : 'Uploading') : zh ? '上传' : 'Upload';

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
            onSelect={() => onHandoff(target)}
          >
            <DropdownMenuIcon>
              <CloudUploadIcon />
            </DropdownMenuIcon>
            {TARGET_LABELS[target][zh ? 'zh' : 'en']}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <CompanionDestinationSettingsSubmenu busy={busy} targets={targets} zh={zh} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
