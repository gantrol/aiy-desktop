import { useI18n } from '@/renderer/i18n/useI18n';
import { CloudUploadIcon, LoaderCircleIcon, MessageCircleIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { ResponsiveButton } from '@/renderer/components/ui/responsive-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { CompanionDestinationMenu } from '@/renderer/features/browser-companion/CompanionDestinationMenu';
import type { BrowserCompanionTarget } from '@/shared/contracts';

export function CompanionHandoffButton({
  disabled,
  busy,
  onHandoff,
  targets,
  variant = 'outline',
  responsive = false,
}: {
  disabled: boolean;
  busy: boolean;
  onHandoff(target: BrowserCompanionTarget): void;
  targets: readonly BrowserCompanionTarget[];
  variant?: ComponentProps<typeof Button>['variant'];
  responsive?: boolean;
  zh?: boolean;
}) {
  const copy = useI18n().messages.browserCompanion;
  const onlyTarget = targets.length === 1 ? targets[0] : null;
  const chatgpt = onlyTarget === 'chatgpt';
  const label = busy ? copy.uploading : chatgpt ? copy.askChatgpt : copy.upload;
  const primaryButton = (
    <ResponsiveButton
      type="button"
      data-action="content-upload"
      variant={variant}
      size="sm"
      className="rounded-r-none"
      label={label}
      responsive={responsive}
      shortLabel={chatgpt && !busy ? copy.targets.chatgpt : undefined}
      disabled={disabled || targets.length === 0}
      aria-busy={busy || undefined}
      onClick={onlyTarget ? () => onHandoff(onlyTarget) : undefined}
    >
      {busy ? (
        <LoaderCircleIcon className="size-4 animate-spin" />
      ) : chatgpt ? (
        <MessageCircleIcon className="size-4" />
      ) : (
        <CloudUploadIcon className="size-4" />
      )}
    </ResponsiveButton>
  );

  return (
    <div className="inline-flex items-center">
      {onlyTarget ? (
        primaryButton
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>{primaryButton}</DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {targets.map((target) => (
              <DropdownMenuItem
                key={target}
                data-browser-companion-target={target}
                disabled={busy}
                onSelect={() => onHandoff(target)}
              >
                {copy.targets[target]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <CompanionDestinationMenu busy={busy} targets={targets} variant={variant} />
    </div>
  );
}
