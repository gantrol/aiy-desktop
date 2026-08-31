import { CheckIcon, ChevronDownIcon, CircleSlashIcon, LoaderCircleIcon } from 'lucide-react';
import { useEffect, useState, type ComponentProps } from 'react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import type {
  BrowserCompanionBrowser,
  BrowserCompanionBrowserId,
  BrowserCompanionDestinationsResult,
  BrowserCompanionTarget,
} from '@/shared/contracts';

const TARGET_LABELS: Record<BrowserCompanionTarget, { en: string; zh: string }> = {
  chatgpt: { en: 'ChatGPT', zh: 'ChatGPT' },
  wechat: { en: 'WeChat Official Account', zh: '微信公众号' },
  weibo: { en: 'Weibo', zh: '微博' },
};

function routeLabel(
  state: BrowserCompanionDestinationsResult | null,
  target: BrowserCompanionTarget,
  zh: boolean,
): string {
  const targetLabel = TARGET_LABELS[target][zh ? 'zh' : 'en'];
  const route = state?.routes[target];
  if (!route) return `${targetLabel} · ${zh ? '未配置' : 'Not configured'}`;
  const browser = state.browsers.find((candidate) => candidate.id === route.browserId);
  const profile = browser?.profiles.find((candidate) => candidate.directory === route.profileDirectory);
  return `${targetLabel} · ${browser?.name ?? route.browserId} · ${profile?.name ?? route.profileDirectory}`;
}

function BrowserDestinationItems({
  browsers,
  busy,
  onSelect,
  state,
  target,
  zh,
}: {
  browsers: readonly BrowserCompanionBrowser[];
  busy: boolean;
  onSelect(target: BrowserCompanionTarget, browserId: BrowserCompanionBrowserId, profileDirectory: string): void;
  state: BrowserCompanionDestinationsResult;
  target: BrowserCompanionTarget;
  zh: boolean;
}) {
  const route = state.routes[target];
  return browsers.flatMap((browser) => {
    if (!browser.available || browser.profiles.length === 0) {
      return [
        <DropdownMenuItem key={browser.id} disabled>
          <DropdownMenuIcon>
            <CircleSlashIcon />
          </DropdownMenuIcon>
          <span className="min-w-0 flex-1 truncate">{browser.name}</span>
          <span className="text-xs text-muted-foreground">
            {!browser.available ? (zh ? '未安装' : 'Unavailable') : zh ? '无 Profile' : 'No Profiles'}
          </span>
        </DropdownMenuItem>,
      ];
    }
    return browser.profiles.map((profile) => {
      const selected = route?.browserId === browser.id && route.profileDirectory === profile.directory;
      return (
        <DropdownMenuItem
          key={`${browser.id}:${profile.directory}`}
          data-browser-companion-browser={browser.id}
          data-browser-companion-profile-option={profile.directory}
          data-browser-companion-target={target}
          disabled={!profile.companionInstalled || busy}
          onSelect={() => onSelect(target, browser.id, profile.directory)}
        >
          <DropdownMenuIcon>{selected ? <CheckIcon /> : <span />}</DropdownMenuIcon>
          <span className="min-w-0 flex-1 truncate">
            {browser.name} · {profile.name}
          </span>
          {!profile.companionInstalled && (
            <span className="text-xs text-muted-foreground">{zh ? '无伴侣' : 'No Companion'}</span>
          )}
        </DropdownMenuItem>
      );
    });
  });
}

export function CompanionDestinationMenu({
  busy,
  targets,
  variant,
  zh,
}: {
  busy: boolean;
  targets: readonly BrowserCompanionTarget[];
  variant: ComponentProps<typeof Button>['variant'];
  zh: boolean;
}) {
  const [state, setState] = useState<BrowserCompanionDestinationsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setState(await window.desktopApi.browserCompanionDestinations());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function selectDestination(
    target: BrowserCompanionTarget,
    browserId: BrowserCompanionBrowserId,
    profileDirectory: string,
  ): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setState(await window.desktopApi.browserCompanionSelectDestination({ target, browserId, profileDirectory }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  const title = targets.map((target) => routeLabel(state, target, zh)).join(' / ');
  const availableBrowsers = state?.browsers.filter((browser) => browser.available) ?? [];

  return (
    <DropdownMenu onOpenChange={(open) => open && void refresh()}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          data-action="browser-companion-profile-menu"
          data-browser-companion-destination-menu
          variant={variant}
          size="icon-sm"
          className="w-7 rounded-l-none border-l-0"
          disabled={busy}
          aria-label={title}
          title={title}
        >
          <ChevronDownIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {loading && !state ? (
          <DropdownMenuItem disabled>
            <DropdownMenuIcon>
              <LoaderCircleIcon className="animate-spin" />
            </DropdownMenuIcon>
            {zh ? '读取浏览器 Profile' : 'Loading browser Profiles'}
          </DropdownMenuItem>
        ) : error ? (
          <DropdownMenuItem disabled>
            <DropdownMenuIcon>
              <CircleSlashIcon />
            </DropdownMenuIcon>
            <span className="truncate">{error}</span>
          </DropdownMenuItem>
        ) : !state || availableBrowsers.length === 0 ? (
          <DropdownMenuItem disabled>
            <DropdownMenuIcon>
              <CircleSlashIcon />
            </DropdownMenuIcon>
            {zh ? '未找到支持的浏览器' : 'No supported browser found'}
          </DropdownMenuItem>
        ) : targets.length === 1 ? (
          <BrowserDestinationItems
            browsers={state.browsers}
            busy={loading}
            onSelect={(target, browserId, profileDirectory) =>
              void selectDestination(target, browserId, profileDirectory)
            }
            state={state}
            target={targets[0]}
            zh={zh}
          />
        ) : (
          targets.map((target) => (
            <DropdownMenuSub key={target}>
              <DropdownMenuSubTrigger>
                <span className="min-w-0 flex-1 truncate">{routeLabel(state, target, zh)}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                <BrowserDestinationItems
                  browsers={state.browsers}
                  busy={loading}
                  onSelect={(selectedTarget, browserId, profileDirectory) =>
                    void selectDestination(selectedTarget, browserId, profileDirectory)
                  }
                  state={state}
                  target={target}
                  zh={zh}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
