import { ImagePlusIcon, SlidersHorizontalIcon } from 'lucide-react';
import type { GenerationQuality, TermIllustrationPurpose } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useTermIllustration } from '@/renderer/features/term-illustration/TermIllustrationProvider';

export function TermIllustrationAction() {
  const { messages } = useI18n();
  const copy = messages.dictionary.detail.illustration;
  const {
    routes,
    routeKey,
    setRouteKey,
    selectedRoute,
    quality,
    setQuality,
    qualities,
    count,
    setCount,
    purpose,
    setPurpose,
    blockedReason,
    actionBusy,
    activeRuns,
    start,
  } = useTermIllustration();
  const generationActive = activeRuns.length > 0;

  return (
    <div className="flex items-center">
      <Button
        data-action="term-illustration-generate"
        type="button"
        size="sm"
        className="rounded-r-none"
        disabled={Boolean(blockedReason) || actionBusy || generationActive}
        title={blockedReason ?? undefined}
        onClick={() => void start()}
      >
        <ImagePlusIcon className="size-3.5" />
        {generationActive ? copy.generating : copy.generate}
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            data-action="term-illustration-settings"
            type="button"
            variant="outline"
            size="icon-sm"
            className="rounded-l-none border-l-0"
            aria-label={copy.settings}
            disabled={actionBusy}
          >
            <SlidersHorizontalIcon className="size-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="w-80 p-4">
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <span className="text-xs font-medium">{copy.purpose}</span>
              <Select value={purpose} onValueChange={(value) => setPurpose(value as TermIllustrationPurpose)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COVER">{copy.purposeCover}</SelectItem>
                  <SelectItem value="RELATED">{copy.purposeRelated}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <span className="text-xs font-medium">{copy.model}</span>
              <Select value={routeKey} onValueChange={setRouteKey} disabled={!routes.length}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {routes.map((route) => (
                    <SelectItem key={route.key} value={route.key}>
                      {route.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <span className="text-xs font-medium">{copy.quality}</span>
                <Select
                  value={quality}
                  onValueChange={(value) => setQuality(value as GenerationQuality)}
                  disabled={selectedRoute?.qualityMode === 'PROVIDER_MANAGED'}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {qualities.map((candidate) => (
                      <SelectItem key={candidate} value={candidate}>
                        {candidate === 'low'
                          ? copy.qualityLow
                          : candidate === 'medium'
                            ? copy.qualityMedium
                            : copy.qualityHigh}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <span className="text-xs font-medium">{copy.count}</span>
                <Select value={String(count)} onValueChange={(value) => setCount(Number(value))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4].map((candidate) => (
                      <SelectItem key={candidate} value={String(candidate)}>
                        {candidate}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {blockedReason && <p className="text-xs leading-5 text-warning">{blockedReason}</p>}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
