import { ChevronDownIcon, Settings2Icon } from 'lucide-react';
import type { ComponentProps } from 'react';
import type { BrowserCompanionTarget, BrowserCompanionWatermarkSelection } from '@/shared/contracts';
import type { PublishingMaskTarget } from '@/shared/contracts/publishing-mask';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { PublishingMaskActions } from '@/renderer/features/browser-companion/PublishingMaskActions';
import { CompanionDestinationPicker } from '@/renderer/features/browser-companion/CompanionDestinationMenu';
import { CompanionWatermarkSubmenu } from '@/renderer/features/browser-companion/CompanionWatermarkMenu';
import type { useWatermarkSelection } from '@/renderer/features/browser-companion/CompanionHandoffMenu';

type DestinationProps = ComponentProps<typeof CompanionDestinationPicker>;

export function ArticleDeliverySettings({
  articleId,
  spaceId,
  busy,
  submitted,
  destinations,
  onDestinationsChange,
  selectedBrowsers,
  availableBrowserTargets,
  watermarkAvailable,
  selectedWatermark,
  watermark,
  maskTargets,
  beforeOpen,
}: {
  articleId: string;
  spaceId: string;
  busy: boolean;
  submitted: boolean;
  destinations: DestinationProps['state'];
  onDestinationsChange: DestinationProps['onChange'];
  selectedBrowsers: readonly BrowserCompanionTarget[];
  availableBrowserTargets: readonly BrowserCompanionTarget[];
  watermarkAvailable: boolean;
  selectedWatermark: BrowserCompanionWatermarkSelection;
  watermark: ReturnType<typeof useWatermarkSelection>;
  maskTargets: readonly PublishingMaskTarget[];
  beforeOpen(): Promise<boolean>;
}) {
  const { messages } = useI18n();
  const copy = messages.articleDelivery.batch;
  const companionCopy = messages.browserCompanion;
  const locked = busy || submitted;
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="group w-full justify-start" disabled={busy}>
          <Settings2Icon className="size-4" />
          {copy.settings}
          <ChevronDownIcon className="ml-auto size-4 transition-transform group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-3 pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <CompanionDestinationPicker
            busy={busy}
            state={destinations}
            targets={selectedBrowsers.length ? selectedBrowsers : availableBrowserTargets}
            onChange={onDestinationsChange}
          />
          {watermarkAvailable && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={locked}>
                  {selectedWatermark.kind === 'NONE' ? companionCopy.noWatermark : companionCopy.watermark}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <CompanionWatermarkSubmenu
                  busy={locked}
                  selection={watermark.selection}
                  onSelectionChange={watermark.select}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {!submitted && (
          <PublishingMaskActions
            spaceId={spaceId}
            source={{ kind: 'ARTICLE', id: articleId }}
            targets={maskTargets}
            disabled={locked}
            beforeOpen={beforeOpen}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
