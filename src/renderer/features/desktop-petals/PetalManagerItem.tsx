import { ExternalLink } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { PetalNoteIcon } from '@/renderer/features/desktop-petals/petal-appearance';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { PetalWorkspaceItem } from '@/shared/contracts/petal-workspace';

export function PetalManagerItem({
  item,
  layerName,
  selected,
  disabled,
  onSelect,
  onAction,
}: {
  item: PetalWorkspaceItem;
  layerName?: string;
  selected: boolean;
  disabled: boolean;
  onSelect(selected: boolean): void;
  onAction(kind: 'open' | 'source'): void;
}) {
  const copy = useI18n().messages.desktopPetals.contentEntry;
  const title = item.title || copy.untitled;
  const report = item.lastFlush?.report;
  return (
    <div role="listitem" className="flex items-start gap-2 border-b border-border/50 py-2.5" data-petal-id={item.id}>
      <Checkbox
        checked={selected}
        disabled={disabled}
        className="mt-1.5"
        aria-label={`${copy.select} · ${title}`}
        onCheckedChange={(checked) => onSelect(checked === true)}
      />
      <PetalNoteIcon icon={item.icon} className="mt-1.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="break-words text-sm font-medium">{title}</div>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{copy[item.placement]}</span>
          {layerName && <span>{layerName}</span>}
          {item.layerHidden && <span>{copy.hiddenLayer}</span>}
          {item.provisional && <span>{copy.provisional}</span>}
          {!item.sourceAvailable && <span className="text-destructive">{copy.unavailable}</span>}
          {item.placement === 'active' && !item.windowVisible && !item.layerHidden && <span>{copy.windowHidden}</span>}
        </div>
        {report && (
          <div className={`mt-1 text-xs ${report.status === 'blocked' ? 'text-destructive' : 'text-muted-foreground'}`}>
            {copy.lastCheck}: {copy[report.status]}
            {report.reason && <span> · {copy.reasons[report.reason]}</span>}
          </div>
        )}
        <div className="mt-1 flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || !item.sourceAvailable || item.layerHidden}
            onClick={() => onAction('open')}
          >
            {copy.open}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || !item.sourceAvailable || item.provisional}
            onClick={() => onAction('source')}
          >
            <ExternalLink className="size-3.5" />
            {copy.source}
          </Button>
        </div>
      </div>
    </div>
  );
}
