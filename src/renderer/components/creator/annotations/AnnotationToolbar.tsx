import {
  BrushIcon,
  CheckIcon,
  EraserIcon,
  EyeIcon,
  EyeOffIcon,
  LoaderCircleIcon,
  Maximize2Icon,
  MinusIcon,
  MousePointer2Icon,
  PlusIcon,
  SendIcon,
} from 'lucide-react';
import { RectIcon } from '@/renderer/icons';
import { Button } from '@/renderer/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/renderer/components/ui/tooltip';
import type { AnnotationLabels, AnnotationMode, BrushMode } from '@/renderer/components/creator/annotations/types';

interface Props {
  labels: AnnotationLabels;
  mode: AnnotationMode;
  brushMode: BrushMode;
  brushRadius: number;
  canEraseBrush: boolean;
  markersVisible: boolean;
  hasMarkers: boolean;
  onModeChange(mode: AnnotationMode): void;
  onBrushModeChange(mode: BrushMode): void;
  onBrushRadiusChange(radius: number): void;
  onMarkersVisibleChange(visible: boolean): void;
  onZoomOut(): void;
  onFit(): void;
  onZoomIn(): void;
  onRefine(): void;
  onDone(): void;
  refineDisabled?: boolean;
  refineDisabledReason?: string;
  refining?: boolean;
  doneDisabled?: boolean;
}

function ToolButton({ label, children, ...props }: React.ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function AnnotationToolbar({
  labels,
  mode,
  brushMode,
  brushRadius,
  canEraseBrush,
  markersVisible,
  hasMarkers,
  onModeChange,
  onBrushModeChange,
  onBrushRadiusChange,
  onMarkersVisibleChange,
  onZoomOut,
  onFit,
  onZoomIn,
  onRefine,
  onDone,
  refineDisabled,
  refineDisabledReason,
  refining,
  doneDisabled,
}: Props) {
  return (
    <TooltipProvider>
      <div className="pointer-events-auto inline-flex min-h-9 w-fit max-w-full flex-wrap items-center justify-center gap-0.5 rounded-lg border border-border bg-overlay p-0.5 text-foreground shadow-overlay">
        <ToolButton
          label={labels.move}
          variant={mode === 'view' ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-pressed={mode === 'view'}
          onClick={() => onModeChange('view')}
        >
          <MousePointer2Icon className="size-4" />
        </ToolButton>
        <ToolButton
          label={labels.brush}
          variant={mode === 'BRUSH' && brushMode === 'ADD' ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-pressed={mode === 'BRUSH' && brushMode === 'ADD'}
          onClick={() => {
            onBrushModeChange('ADD');
            onModeChange('BRUSH');
          }}
        >
          <BrushIcon className="size-4" />
        </ToolButton>
        <ToolButton
          label={labels.eraseBrush}
          variant={mode === 'BRUSH' && brushMode === 'ERASE' ? 'secondary' : 'ghost'}
          size="icon-sm"
          disabled={!canEraseBrush}
          aria-pressed={mode === 'BRUSH' && brushMode === 'ERASE'}
          onClick={() => {
            onBrushModeChange('ERASE');
            onModeChange('BRUSH');
          }}
        >
          <EraserIcon className="size-4" />
        </ToolButton>
        <ToolButton
          label={labels.brushSize}
          variant="ghost"
          size="icon-sm"
          disabled={mode !== 'BRUSH'}
          onClick={() => onBrushRadiusChange(brushRadius < 0.02 ? 0.03 : brushRadius < 0.04 ? 0.05 : 0.015)}
        >
          <span
            className="block rounded-full bg-current"
            style={{
              width: `${Math.round(4 + brushRadius * 160)}px`,
              height: `${Math.round(4 + brushRadius * 160)}px`,
            }}
          />
        </ToolButton>
        <ToolButton
          label={labels.rectangle}
          variant={mode === 'RECTANGLE' ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-pressed={mode === 'RECTANGLE'}
          onClick={() => onModeChange('RECTANGLE')}
        >
          <RectIcon className="size-4" />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <ToolButton
          label={markersVisible ? labels.hideMarkers : labels.showMarkers}
          variant={markersVisible ? 'ghost' : 'secondary'}
          size="icon-sm"
          disabled={!hasMarkers}
          aria-pressed={markersVisible}
          onClick={() => onMarkersVisibleChange(!markersVisible)}
        >
          {markersVisible ? <EyeIcon className="size-4" /> : <EyeOffIcon className="size-4" />}
        </ToolButton>
        <ToolButton label={labels.zoomOut} variant="ghost" size="icon-sm" onClick={onZoomOut}>
          <MinusIcon className="size-4" />
        </ToolButton>
        <ToolButton label={labels.fit} variant="ghost" size="icon-sm" onClick={onFit}>
          <Maximize2Icon className="size-4" />
        </ToolButton>
        <ToolButton label={labels.zoomIn} variant="ghost" size="icon-sm" onClick={onZoomIn}>
          <PlusIcon className="size-4" />
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
        <Button
          variant="default"
          size="sm"
          className="h-8"
          title={refineDisabledReason || labels.refine}
          disabled={refineDisabled || refining}
          onClick={onRefine}
        >
          {refining ? <LoaderCircleIcon className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
          {refining ? labels.refining : labels.refine}
        </Button>
        <Button variant="ghost" size="sm" className="ml-1 h-8" disabled={doneDisabled} onClick={onDone}>
          <CheckIcon className="size-4" />
          {labels.done}
        </Button>
      </div>
    </TooltipProvider>
  );
}
