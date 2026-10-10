import { useEffect, useRef } from 'react';
import { Textarea } from '@/renderer/components/ui/textarea';
import type { ImageEditMark } from '@/shared/contracts/image-edit';
import { fitTextHeight } from '@/renderer/features/image-editing/image-edit-text';

export function ImageEditText({
  mark,
  label,
  onChange,
  onFinish,
  onComposing,
}: {
  mark: ImageEditMark;
  label: string;
  onChange(mark: ImageEditMark): void;
  onFinish(focus?: boolean): void;
  onComposing(value: boolean): void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  useEffect(() => {
    input.current?.focus();
    const length = input.current?.value.length ?? 0;
    input.current?.setSelectionRange(length, length);
    return () => onComposing(false);
  }, [mark.id, onComposing]);
  return (
    <foreignObject
      x={mark.x}
      y={mark.y}
      width={Math.max(24, mark.width)}
      height={Math.max(mark.fontSize * 1.25 + 4, mark.height + 4)}
      overflow="visible"
    >
      <Textarea
        ref={input}
        aria-label={label}
        value={mark.text}
        maxLength={2000}
        spellCheck={false}
        wrap={mark.wrap ? 'soft' : 'off'}
        className="block size-full min-h-0 resize-none overflow-hidden rounded-none border-0 bg-transparent p-0 shadow-none outline outline-1 outline-ring"
        style={{
          color: mark.color,
          fontSize: mark.fontSize,
          fontFamily: mark.fontFamily ?? 'sans-serif',
          lineHeight: '1.25',
          wordBreak: 'break-all',
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onCompositionStart={() => {
          composing.current = true;
          onComposing(true);
        }}
        onCompositionEnd={() => {
          composing.current = false;
          onComposing(false);
        }}
        onChange={(event) => onChange(fitTextHeight({ ...mark, text: event.target.value }))}
        onBlur={() => {
          if (!composing.current) onFinish();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape' && !event.nativeEvent.isComposing && !composing.current) {
            event.preventDefault();
            onFinish(true);
          }
        }}
      />
    </foreignObject>
  );
}
