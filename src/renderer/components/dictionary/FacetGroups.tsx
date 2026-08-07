import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { FacetDefinitionDto } from '@/shared/contracts';
import { cn } from '@/renderer/lib/utils';
import { Checkbox } from '@/renderer/components/ui/checkbox';

interface Props {
  facets: FacetDefinitionDto[];
  selectedIds: string[];
  mode: 'filter' | 'editor';
  onToggle(valueId: string): void;
}

export function FacetGroups({ facets, selectedIds, mode, onToggle }: Props) {
  return (
    <div className={cn(mode === 'editor' && 'grid grid-cols-1 gap-x-6 2xl:grid-cols-2')}>
      {facets.map((facet, index) => (
        <FacetGroup
          key={facet.id}
          facet={facet}
          selectedIds={selectedIds}
          mode={mode}
          initiallyOpen={mode === 'filter' && index < 2}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

function FacetGroup({
  facet,
  selectedIds,
  mode,
  initiallyOpen,
  onToggle,
}: {
  facet: FacetDefinitionDto;
  selectedIds: string[];
  mode: Props['mode'];
  initiallyOpen: boolean;
  onToggle(valueId: string): void;
}) {
  const selectedCount = facet.values.filter((value) => selectedIds.includes(value.id)).length;
  const [open, setOpen] = useState(initiallyOpen || selectedCount > 0);
  useEffect(() => {
    if (selectedCount > 0) setOpen(true);
  }, [selectedCount]);
  return (
    <details className="group border-t" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
        <span className="flex-1">{facet.name}</span>
        <small>
          {selectedCount ? `${selectedCount} / ` : ''}
          {facet.values.length}
        </small>
      </summary>
      <div
        className={cn(mode === 'filter' ? 'grid grid-cols-2 gap-2 pb-3 pl-6' : 'pb-3 pl-6')}
        role="group"
        aria-label={facet.name}
      >
        {facet.values.map((value) => {
          const selected = selectedIds.includes(value.id);
          return (
            <label
              key={value.id}
              className={cn(
                'cursor-pointer text-xs',
                mode === 'filter' && 'grid min-w-0 grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-2',
                mode === 'editor' &&
                  'mr-2 mb-2 inline-flex items-center gap-2 rounded-full border bg-background px-3 py-2',
                mode === 'editor' && selected && 'border-selected-border bg-selected text-selected-foreground',
              )}
            >
              <Checkbox checked={selected} onCheckedChange={() => onToggle(value.id)} />
              <span className="truncate">{value.name}</span>
              {mode === 'filter' && <small className="text-muted-foreground">{value.count}</small>}
            </label>
          );
        })}
      </div>
    </details>
  );
}
