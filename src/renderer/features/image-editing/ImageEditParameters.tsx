import { Input } from '@/renderer/components/ui/input';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Button } from '@/renderer/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ImageEditDocument, ImageEditMark } from '@/shared/contracts/image-edit';
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
interface Props {
  document: ImageEditDocument;
  tool: ImageEditTool;
  selected: string | null;
  color: string;
  stroke: number;
  fontSize: number;
  disabled: boolean;
  onSelect(id: string | null): void;
  onChange(document: ImageEditDocument): void;
  onStyle(patch: Partial<Pick<ImageEditMark, 'color' | 'stroke' | 'fontSize'>>): void;
  onComposing(value: boolean): void;
}
export function ImageEditParameters(props: Props) {
  const { messages } = useI18n(),
    copy = messages.desktopPetals.imageEditor;
  const mark = props.document.marks.find((value) => value.id === props.selected);
  const crop = props.document.crop;
  const rotated = props.document.rotation % 2 !== 0;
  const text = mark && ['text', 'number'].includes(mark.kind);
  const active = mark?.kind ?? props.tool;
  return (
    <fieldset
      disabled={props.disabled}
      className="flex flex-wrap items-center gap-2 border-t border-border px-2 py-1.5"
    >
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
          {(props.tool !== 'select' || mark) && (
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
          {props.document.marks.length > 0 && (
            <Select
              value={props.selected ?? 'none'}
              onValueChange={(value) => props.onSelect(value === 'none' ? null : value)}
              disabled={props.disabled}
            >
              <SelectTrigger className="ml-auto h-8 w-36" aria-label={copy.selectObject}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{copy.noSelection}</SelectItem>
                {props.document.marks.map((value, index) => (
                  <SelectItem key={value.id} value={value.id}>{`${index + 1} · ${copy[value.kind]}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </>
      )}
      {text && (
        <Textarea
          key={mark.id}
          autoFocus
          rows={2}
          className="min-h-12 w-full resize-none"
          aria-label={copy.text}
          value={mark.text}
          maxLength={2000}
          onCompositionStart={() => props.onComposing(true)}
          onCompositionEnd={() => props.onComposing(false)}
          onChange={(event) =>
            props.onChange({
              ...props.document,
              marks: props.document.marks.map((value) =>
                value.id === mark.id
                  ? {
                      ...value,
                      text: event.target.value,
                      height: Math.max(
                        mark.fontSize * 1.25,
                        event.target.value.split('\n').length * mark.fontSize * 1.25,
                      ),
                    }
                  : value,
              ),
            })
          }
        />
      )}
    </fieldset>
  );
}
