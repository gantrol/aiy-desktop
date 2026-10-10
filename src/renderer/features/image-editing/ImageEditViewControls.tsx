import { Check, CircleAlert, LoaderCircle, Scan, Minus, Plus } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/renderer/components/ui/popover';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/renderer/components/ui/select';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/renderer/components/ui/tooltip';
import { ImageOutputSize } from '@/renderer/features/image-editing/ImageEditParameters';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ImageEditDocument } from '@/shared/contracts/image-edit';

export function ImageEditViewControls(props: {
  document: ImageEditDocument;
  selected: string | null;
  zoom: number | null;
  original: boolean;
  disabled: boolean;
  saving: boolean;
  error: boolean;
  onZoom(value: number | null): void;
  onOriginal(value: boolean): void;
  onSelect(value: string | null): void;
  onChange(value: ImageEditDocument): void;
  onRetry(): void;
}) {
  const copy = useI18n().messages.desktopPetals.imageEditor;
  const status = props.error ? copy.unsaved : props.saving ? copy.saving : copy.saved;
  const StatusIcon = props.error ? CircleAlert : props.saving ? LoaderCircle : Check;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={status}
            disabled={!props.error || props.disabled}
            onClick={props.onRetry}
          >
            <StatusIcon className={props.error ? 'size-3.5 text-destructive' : 'size-3.5 text-muted-foreground'} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{status}</TooltipContent>
      </Tooltip>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label={copy.fit} disabled={props.disabled}>
            <Scan className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 space-y-2 p-2">
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant={props.original ? 'secondary' : 'ghost'}
              aria-pressed={props.original}
              onClick={() => props.onOriginal(!props.original)}
            >
              {copy.original}
            </Button>
            <Button size="sm" variant={props.zoom === null ? 'secondary' : 'ghost'} onClick={() => props.onZoom(null)}>
              {copy.fit}
            </Button>
            <Button size="sm" variant={props.zoom === 1 ? 'secondary' : 'ghost'} onClick={() => props.onZoom(1)}>
              {copy.actual}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={copy.zoomOut}
              onClick={() => props.onZoom(Math.max(0.1, (props.zoom ?? 1) / 1.25))}
            >
              <Minus className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="size-7"
              aria-label={copy.zoomIn}
              onClick={() => props.onZoom(Math.min(4, (props.zoom ?? 1) * 1.25))}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          <fieldset disabled={props.original} className="flex flex-wrap items-center gap-1">
            <ImageOutputSize document={props.document} onChange={props.onChange} />
          </fieldset>
          {props.document.marks.length > 0 && (
            <Select
              value={props.selected ?? 'none'}
              onValueChange={(value) => props.onSelect(value === 'none' ? null : value)}
            >
              <SelectTrigger className="h-8" aria-label={copy.selectObject}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{copy.noSelection}</SelectItem>
                {props.document.marks.map((mark, index) => (
                  <SelectItem key={mark.id} value={mark.id}>{`${index + 1} · ${copy[mark.kind]}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}
