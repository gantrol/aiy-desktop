import {
  ArrowUpRight,
  Crop,
  MousePointer2,
  RectangleHorizontal,
  Type,
  Square,
  Pencil,
  Highlighter,
  ListOrdered,
  Undo2,
  Redo2,
  MoreHorizontal,
  RotateCw,
  FlipHorizontal2,
  FlipVertical2,
  Trash2,
  Copy,
  ChevronDown,
  ShieldCheck,
  Minus,
  Circle,
  Grid2X2,
  Droplets,
  Hand,
} from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/renderer/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ImageEditTool } from '@/renderer/features/image-editing/image-edit-geometry';

interface Props {
  captureMode?: boolean;
  tool: ImageEditTool;
  disabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  selected: boolean;
  onTool(tool: ImageEditTool): void;
  onUndo(): void;
  onRedo(): void;
  onPrivacy(): void;
  onRecognize(mode: 'ocr' | 'qr'): void;
  onAction(
    action: 'rotate' | 'flipX' | 'flipY' | 'delete' | 'duplicate' | 'front' | 'back' | 'clear' | 'restore',
  ): void;
  onCancel(): void;
  onFinish(action: 'done' | 'copy' | 'convert'): void;
}
export function ImageEditToolbar(props: Props) {
  const { messages } = useI18n();
  const copy = messages.desktopPetals.imageEditor;
  const tools = {
    select: MousePointer2,
    pan: Hand,
    crop: Crop,
    arrow: ArrowUpRight,
    rectangle: RectangleHorizontal,
    text: Type,
    cover: Square,
  };
  return (
    <div className="flex flex-wrap items-center gap-1 border-t border-border px-2 py-1.5">
      {Object.entries(tools).map(([tool, Icon]) => (
        <Tooltip key={tool}>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant={props.tool === tool ? 'secondary' : 'ghost'}
              className="size-8"
              aria-label={copy[tool as keyof typeof tools]}
              aria-pressed={props.tool === tool}
              disabled={props.disabled}
              onClick={() => props.onTool(tool as ImageEditTool)}
            >
              <Icon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copy[tool as keyof typeof tools]}</TooltipContent>
        </Tooltip>
      ))}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant={
              ['line', 'ellipse', 'pen', 'highlight', 'number', 'mosaic', 'blur'].includes(props.tool)
                ? 'secondary'
                : 'ghost'
            }
            className="size-8"
            aria-label={copy.more}
            data-image-tools
            disabled={props.disabled}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => props.onRecognize('ocr')}>{copy.recognition.ocr}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => props.onRecognize('qr')}>{copy.recognition.qr}</DropdownMenuItem>
          <DropdownMenuItem onSelect={props.onPrivacy}>
            <ShieldCheck />
            {copy.privacy.title}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {(
            [
              ['pen', Pencil],
              ['highlight', Highlighter],
              ['number', ListOrdered],
              ['line', Minus],
              ['ellipse', Circle],
              ['mosaic', Grid2X2],
              ['blur', Droplets],
            ] as const
          ).map(([tool, Icon]) => (
            <DropdownMenuItem key={tool} onSelect={() => props.onTool(tool)}>
              <Icon />
              {copy[tool]}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => props.onAction('rotate')}>
            <RotateCw />
            {copy.rotate}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => props.onAction('flipX')}>
            <FlipHorizontal2 />
            {copy.flipX}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => props.onAction('flipY')}>
            <FlipVertical2 />
            {copy.flipY}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!props.selected} onSelect={() => props.onAction('duplicate')}>
            <Copy />
            {copy.duplicate}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!props.selected} onSelect={() => props.onAction('front')}>
            {copy.front}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!props.selected} onSelect={() => props.onAction('back')}>
            {copy.back}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!props.selected} onSelect={() => props.onAction('delete')}>
            <Trash2 />
            {copy.delete}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => props.onAction('clear')}>{copy.clear}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => props.onAction('restore')}>{copy.restore}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label={copy.undo}
        disabled={props.disabled || !props.canUndo}
        onClick={props.onUndo}
      >
        <Undo2 className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label={copy.redo}
        disabled={props.disabled || !props.canRedo}
        onClick={props.onRedo}
      >
        <Redo2 className="size-4" />
      </Button>
      <div className="ml-auto flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={props.disabled} onClick={props.onCancel}>
          {copy.cancel}
        </Button>
        <Button size="sm" disabled={props.disabled} onClick={() => props.onFinish('done')}>
          {copy.done}
        </Button>
        {!props.captureMode && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" className="size-8" aria-label={copy.finishActions} disabled={props.disabled}>
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => props.onFinish('copy')}>{copy.doneCopy}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => props.onFinish('convert')}>{copy.doneConvert}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
