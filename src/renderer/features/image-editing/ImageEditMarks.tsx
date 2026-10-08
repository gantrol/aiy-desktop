import type { ImageEditMark } from '@/shared/contracts/image-edit';
import { arrowPath, markBounds, penPath } from '@/renderer/features/image-editing/image-edit-geometry';

export function ImageEditMarks({ marks }: { marks: ImageEditMark[] }) {
  return marks.map((mark) => {
    const box = markBounds(mark);
    return (
      <g
        key={mark.id}
        data-mark={mark.id}
        stroke={mark.color}
        fill="none"
        strokeWidth={mark.stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {mark.kind === 'arrow' || mark.kind === 'pen' ? (
          <>
            <path d={mark.kind === 'arrow' ? arrowPath(mark) : penPath(mark)} />
            <path
              d={mark.kind === 'arrow' ? arrowPath(mark) : penPath(mark)}
              stroke="transparent"
              strokeWidth={Math.max(mark.stroke, 12)}
              pointerEvents="stroke"
            />
          </>
        ) : mark.kind === 'text' || mark.kind === 'number' ? (
          <text
            x={mark.x}
            y={mark.y + mark.fontSize}
            fill={mark.color}
            stroke="none"
            fontSize={mark.fontSize}
            fontFamily="sans-serif"
            dominantBaseline="alphabetic"
          >
            {mark.text.split('\n').map((line, i) => (
              <tspan key={i} x={mark.x} dy={i ? mark.fontSize * 1.25 : 0}>
                {line || '\u00a0'}
              </tspan>
            ))}
          </text>
        ) : (
          <rect
            {...box}
            fill={mark.kind === 'rectangle' ? 'transparent' : mark.color}
            stroke={mark.kind === 'rectangle' ? mark.color : 'none'}
            opacity={mark.kind === 'highlight' ? 0.35 : 1}
          />
        )}
      </g>
    );
  });
}
