import { useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import type { ImageGenerationRouteDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { ModelSelectionCommand, type ModelCapabilityTag } from '@/renderer/components/creator/ModelSelectionCommand';

interface Props {
  routes: ImageGenerationRouteDto[];
  selectedModelKeys: string[];
  compact?: boolean;
  capabilityTag?: ModelCapabilityTag;
  onSelectedModelKeysChange(modelKeys: string[]): void;
  onConfigureExtension?(extensionId: string): void;
}

export function ModelTargetSelector({
  routes,
  selectedModelKeys,
  compact = false,
  capabilityTag,
  onSelectedModelKeysChange,
  onConfigureExtension,
}: Props) {
  const labels = useI18n().messages.creator.generationTargets;
  const [open, setOpen] = useState(false);
  const selected = selectedModelKeys.flatMap((key) => routes.find((model) => model.key === key) ?? []);
  const summary = selected.length
    ? selected
        .map((model) => (model.key === 'internal-library-random' ? labels.internalLibraryRandom : model.name))
        .join(' + ')
    : labels.noneSelected;

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          data-action="model-target-selector"
          type="button"
          variant={compact ? 'ghost' : 'outline'}
          size="sm"
          className={
            compact
              ? 'h-8 min-w-0 flex-1 shrink justify-between gap-1.5 px-1.5 font-semibold shadow-none'
              : 'max-w-full justify-between gap-2'
          }
          aria-label={`${labels.models}: ${summary}`}
        >
          <span className="truncate">{summary}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-80 p-0">
        <ModelSelectionCommand
          routes={routes}
          selectedModelKeys={selectedModelKeys}
          capabilityTag={capabilityTag}
          onSelectedModelKeysChange={onSelectedModelKeysChange}
          onConfigureExtension={
            onConfigureExtension
              ? (extensionId) => {
                  setOpen(false);
                  onConfigureExtension(extensionId);
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  );
}
