import { PlusIcon } from 'lucide-react';
import type { ImageGenerationRouteDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { ModelSelectionCommand } from '@/renderer/components/creator/ModelSelectionCommand';

interface Props {
  routes: ImageGenerationRouteDto[];
  selectedModelKeys: string[];
  onSelectedModelKeysChange(modelKeys: string[]): void;
}

export function ComparisonModelPicker({ routes, selectedModelKeys, onSelectedModelKeysChange }: Props) {
  const messages = useI18n().messages.creator;
  const labels = messages.comparison;
  const selectedCount = selectedModelKeys.filter((key) => routes.some((model) => model.key === key)).length;
  return (
    <Popover modal>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 shrink-0 px-2" aria-label={labels.addModel}>
          <PlusIcon className="size-3.5" />
          {labels.addModel}
          {selectedCount > 0 && (
            <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[9px]">
              {selectedCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-80 p-0">
        <p className="border-b px-3 py-2 text-xs leading-relaxed text-muted-foreground">{labels.addModelHint}</p>
        <ModelSelectionCommand
          routes={routes}
          selectedModelKeys={selectedModelKeys}
          emptyText={labels.noModelsToAdd}
          onSelectedModelKeysChange={onSelectedModelKeysChange}
        />
      </PopoverContent>
    </Popover>
  );
}
