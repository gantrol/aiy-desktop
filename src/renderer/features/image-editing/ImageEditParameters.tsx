import { Input } from '@/renderer/components/ui/input';
import { Button } from '@/renderer/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  IMAGE_EDIT_MAX_EDGE,
  IMAGE_EDIT_MAX_PIXELS,
  type ImageEditDocument,
  type ImageEditMark,
} from '@/shared/contracts/image-edit';
import type { ImageEditTool } from '@/renderer/features/image-editing/image-edit-geometry';

function EditNumber({
  value,
  min,
  max,
  label,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange(value: number): void;
}) {
  return (
    <Input
      key={value}
      type="number"
      className="h-8 w-20"
      defaultValue={value}
      min={min}
      max={max}
      aria-label={label}
      title={label}
      onBlur={(event) => {
        const next = Number(event.currentTarget.value);
        if (event.currentTarget.value.trim() && Number.isFinite(next) && next >= min && next <= max)
          onChange(Math.round(next));
        else event.currentTarget.value = String(value);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur();
      }}
    />
  );
}
export function ImageOutputSize({
  document,
  onChange,
}: {
  document: ImageEditDocument;
  onChange(document: ImageEditDocument): void;
}) {
  const copy = useI18n().messages.desktopPetals.imageEditor;
  const rotated = document.rotation % 2 !== 0;
  const output = document.output ?? {
    width: rotated ? document.crop.height : document.crop.width,
    height: rotated ? document.crop.width : document.crop.height,
  };
  return (
    <>
      <span className="text-xs">{copy.outputSize}</span>
      <EditNumber
        value={output.width}
        min={1}
        max={Math.min(IMAGE_EDIT_MAX_EDGE, Math.floor(IMAGE_EDIT_MAX_PIXELS / output.height))}
        label={copy.width}
        onChange={(width) => onChange({ ...document, output: { ...output, width } })}
      />
      <span aria-hidden="true">×</span>
      <EditNumber
        value={output.height}
        min={1}
        max={Math.min(IMAGE_EDIT_MAX_EDGE, Math.floor(IMAGE_EDIT_MAX_PIXELS / output.width))}
        label={copy.height}
        onChange={(height) => onChange({ ...document, output: { ...output, height } })}
      />
      <Button size="sm" variant="ghost" onClick={() => onChange({ ...document, output: undefined })}>
        {copy.resetOutput}
      </Button>
    </>
  );
}
interface Props {
  document: ImageEditDocument;
  tool: ImageEditTool;
  selected: string | null;
  color: string;
  stroke: number;
  fontSize: number;
  fontFamily: ImageEditMark['fontFamily'];
  disabled: boolean;
  onSelect(id: string | null): void;
  onChange(document: ImageEditDocument): void;
  onStyle(patch: Partial<Pick<ImageEditMark, 'color' | 'stroke' | 'fontSize' | 'fontFamily'>>): void;
}
export function ImageEditParameters(props: Props) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals.imageEditor;
  const mark = props.document.marks.find((value) => value.id === props.selected);
  const crop = props.document.crop;
  const rotated = props.document.rotation % 2 !== 0;
  const active = mark?.kind ?? props.tool;
  if (['select', 'pan'].includes(active) && !mark) return null;
  return (
    <fieldset disabled={props.disabled} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
      <span className="text-xs text-muted-foreground">{copy[active]}</span>
      {props.tool === 'crop' ? (
        <>
          <EditNumber
            value={rotated ? crop.height : crop.width}
            min={1}
            max={rotated ? props.document.height - crop.y : props.document.width - crop.x}
            label={copy.width}
            onChange={(value) =>
              props.onChange({ ...props.document, crop: { ...crop, [rotated ? 'height' : 'width']: value } })
            }
          />
          <span aria-hidden="true">×</span>
          <EditNumber
            value={rotated ? crop.width : crop.height}
            min={1}
            max={rotated ? props.document.width - crop.x : props.document.height - crop.y}
            label={copy.height}
            onChange={(value) =>
              props.onChange({ ...props.document, crop: { ...crop, [rotated ? 'width' : 'height']: value } })
            }
          />
          <span className="text-xs">px</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              props.onChange({
                ...props.document,
                crop: { x: 0, y: 0, width: props.document.width, height: props.document.height },
              })
            }
          >
            {copy.resetCrop}
          </Button>
        </>
      ) : (
        <>
          {((props.tool !== 'select' && props.tool !== 'pan') || mark) && (
            <>
              <Input
                type="color"
                className="h-8 w-10 cursor-pointer p-1"
                aria-label={copy.color}
                value={mark?.color ?? props.color}
                onChange={(e) => props.onStyle({ color: e.target.value })}
              />
              {!['text', 'number', 'cover', 'highlight'].includes(active) && (
                <EditNumber
                  value={mark?.stroke ?? props.stroke}
                  min={1}
                  max={100}
                  label={copy.stroke}
                  onChange={(stroke) => props.onStyle({ stroke })}
                />
              )}
              {['text', 'number'].includes(active) && (
                <Select
                  value={mark?.fontFamily ?? props.fontFamily ?? 'sans-serif'}
                  onValueChange={(fontFamily) =>
                    props.onStyle({ fontFamily: fontFamily as ImageEditMark['fontFamily'] })
                  }
                >
                  <SelectTrigger className="h-8 w-32" aria-label={copy.fontFamily}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['sans-serif', 'serif', 'monospace'] as const).map((font) => (
                      <SelectItem key={font} value={font}>
                        {copy.fonts[font]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {['text', 'number'].includes(active) && (
                <EditNumber
                  value={mark?.fontSize ?? props.fontSize}
                  min={8}
                  max={240}
                  label={copy.fontSize}
                  onChange={(fontSize) => props.onStyle({ fontSize })}
                />
              )}
            </>
          )}
        </>
      )}
    </fieldset>
  );
}
