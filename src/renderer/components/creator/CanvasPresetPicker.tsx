import { useState } from 'react';
import { ChevronDownIcon, ProportionsIcon } from 'lucide-react';
import type { CanvasPresetDto, Locale } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';

interface Props {
  locale: Locale;
  presets: CanvasPresetDto[];
  value: CanvasPresetDto | undefined;
  compact?: boolean;
  toolbar?: boolean;
  onChange(preset: CanvasPresetDto | undefined): void;
}

function RatioSwatch({ preset }: { preset: CanvasPresetDto }) {
  return (
    <span className="grid h-9 w-12 shrink-0 place-items-center" aria-hidden="true">
      <i
        className="block max-h-9 max-w-12 rounded-[2px] border border-current bg-current/10"
        style={{
          aspectRatio: `${preset.width} / ${preset.height}`,
          width: preset.width >= preset.height ? 44 : 'auto',
          height: preset.height > preset.width ? 34 : 'auto',
        }}
      />
    </span>
  );
}

export function CanvasPresetPicker({ presets, value, compact = false, toolbar = false, onChange }: Props) {
  const { messages } = useI18n();
  const c = messages.creator.canvas;
  const [open, setOpen] = useState(false);

  return (
    <div className={toolbar ? 'contents' : 'grid gap-1.5'}>
      {!toolbar && <span className="text-xs text-muted-foreground">{c.label}</span>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            data-action="canvas-preset-picker"
            type="button"
            variant={toolbar ? 'ghost' : 'outline'}
            size={toolbar ? 'sm' : undefined}
            className={
              toolbar
                ? 'h-8 gap-1.5 rounded-md px-2 font-medium shadow-none data-[state=open]:bg-accent'
                : 'h-auto w-full justify-start gap-3 px-3 py-2 text-left'
            }
          >
            {toolbar ? (
              <>
                <ProportionsIcon className="size-4" />
                <span className="tabular-nums">{value?.ratio ?? c.unspecified}</span>
                <ChevronDownIcon className="size-3.5 text-muted-foreground" />
              </>
            ) : value ? (
              <>
                <RatioSwatch preset={value} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <strong>{value.ratio}</strong>
                    <span className="truncate text-xs font-normal">{value.name}</span>
                  </span>
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    {value.width} × {value.height}
                  </span>
                </span>
                <ChevronDownIcon className="size-4 text-muted-foreground" />
              </>
            ) : (
              <span>{c.unspecified}</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-[390px] max-w-[calc(100vw-2rem)] p-2">
          <div className="mb-1 px-2 py-1 text-xs font-medium text-muted-foreground">{c.choose}</div>
          <div className="max-h-[390px] overflow-y-auto">
            <button
              type="button"
              className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent ${!value ? 'bg-accent' : ''}`}
              aria-pressed={!value}
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              <span className="grid h-9 w-12 shrink-0 place-items-center text-muted-foreground" aria-hidden="true">
                <ProportionsIcon className="size-5" />
              </span>
              <span className="min-w-0 flex-1 text-sm font-medium">{c.unspecified}</span>
            </button>
            {presets.map((preset) => (
              <button
                type="button"
                className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent ${preset.stableKey === value?.stableKey ? 'bg-accent' : ''}`}
                aria-pressed={preset.stableKey === value?.stableKey}
                key={preset.stableKey}
                onClick={() => {
                  onChange(preset);
                  setOpen(false);
                }}
              >
                <RatioSwatch preset={preset} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <strong className="text-sm">{preset.ratio}</strong>
                    <span className="truncate text-sm">{preset.name}</span>
                  </span>
                  {!compact && <span className="block text-xs leading-snug text-muted-foreground">{preset.note}</span>}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {preset.width}×{preset.height}
                </span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {!toolbar && !compact && value && (
        <span className="text-[11px] leading-snug text-muted-foreground">{value.note}</span>
      )}
    </div>
  );
}
