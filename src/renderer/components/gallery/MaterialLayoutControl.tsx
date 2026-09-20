import { Columns3Icon, Rows3Icon } from 'lucide-react';
import { useId } from 'react';
import { useMaterialLayoutPreferences } from '@/renderer/components/gallery/materialLayoutPreferences';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Label } from '@/renderer/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Slider } from '@/renderer/components/ui/slider';
import { useI18n } from '@/renderer/i18n/useI18n';

export function MaterialLayoutControl({ showNamesControl = true }: { showNamesControl?: boolean }) {
  const { messages } = useI18n();
  const l = messages.gallery.library;
  const { preferences, updatePreferences } = useMaterialLayoutPreferences();
  const nameId = useId();
  const sizeId = useId();
  const Icon = preferences.arrangement === 'ROWS' ? Rows3Icon : Columns3Icon;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9" aria-label={l.viewLabel} title={l.viewLabel}>
          <Icon className="size-4" />
          {l.arrangement}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-4">
        <Segmented
          type="single"
          className="w-full"
          value={preferences.arrangement}
          aria-label={l.viewLabel}
          onValueChange={(value) => {
            if (value === 'ROWS' || value === 'COLUMNS') updatePreferences({ arrangement: value });
          }}
        >
          <SegmentedItem value="ROWS" className="flex-1">
            <Rows3Icon className="size-4" />
            {l.rowView}
          </SegmentedItem>
          <SegmentedItem value="COLUMNS" className="flex-1">
            <Columns3Icon className="size-4" />
            {l.columnView}
          </SegmentedItem>
        </Segmented>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label id={sizeId}>{l.thumbnailSize}</Label>
            <span className="text-xs tabular-nums text-muted-foreground">{preferences.size}</span>
          </div>
          <Slider
            min={120}
            max={320}
            step={4}
            value={[preferences.size]}
            aria-labelledby={sizeId}
            onValueChange={([size]) => updatePreferences({ size })}
          />
        </div>
        {showNamesControl && (
          <div className="flex items-center gap-2">
            <Checkbox
              id={nameId}
              checked={preferences.showNames}
              onCheckedChange={(value) => updatePreferences({ showNames: value === true })}
            />
            <Label htmlFor={nameId}>{l.showNames}</Label>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
