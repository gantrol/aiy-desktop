import { useEffect, useRef } from 'react';
import type { ReadingLocation, ReadingPosition } from '@/shared/contracts/creation-reading';

export interface ReadingSelection {
  text: string;
  location: ReadingLocation;
}
export interface ReadingReveal {
  location: ReadingLocation;
  quote?: string;
  position?: ReadingPosition;
}
export type ReadingViewportPosition = Omit<ReadingPosition, 'sourceId'>;

export function ReadingText({
  text,
  location,
  onSelect,
  fontSize = 16,
  reveal,
  initialPosition,
  onPosition,
  onRevealFailed,
}: {
  text: string;
  location: ReadingLocation;
  fontSize?: number;
  reveal?: ReadingReveal;
  initialPosition?: ReadingPosition;
  onPosition?(position: ReadingViewportPosition): void;
  onRevealFailed?(): void;
  onSelect(selection: ReadingSelection | null): void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current,
      node = element?.firstChild;
    if (!element || !node || node.nodeType !== Node.TEXT_NODE) {
      if (reveal?.quote) onRevealFailed?.();
      return;
    }
    const target = reveal?.location;
    if (target && (target.page !== location.page || target.chapter !== location.chapter)) return;
    if (!reveal?.quote) {
      const position = reveal?.position ?? initialPosition;
      if (position && position.page === location.page) {
        if (position.textOffset !== undefined && position.textOffset < text.length) {
          const range = document.createRange();
          range.setStart(node, position.textOffset);
          range.setEnd(node, Math.min(text.length, position.textOffset + 1));
          element.scrollTop += range.getBoundingClientRect().top - element.getBoundingClientRect().top - 20;
        } else element.scrollTop = position.scrollTop;
      }
      if (reveal) element.focus({ preventScroll: true });
      return;
    }
    if (
      target?.start === undefined ||
      target.end === undefined ||
      target.start >= target.end ||
      target.end > text.length ||
      text.slice(target.start, target.end) !== reveal.quote
    ) {
      onSelect(null);
      onRevealFailed?.();
      return;
    }
    const range = document.createRange();
    range.setStart(node, target.start);
    range.setEnd(node, target.end);
    element.focus({ preventScroll: true });
    const selected = window.getSelection();
    selected?.removeAllRanges();
    selected?.addRange(range);
    const rect = range.getBoundingClientRect();
    element.scrollTop += rect.top - element.getBoundingClientRect().top - 20;
    onSelect({ text: range.toString(), location: target });
  }, [reveal, initialPosition, text, location.page, location.chapter, onSelect, onRevealFailed]);
  const capture = () => {
    const selected = window.getSelection(),
      element = root.current;
    if (!element || !selected?.rangeCount || selected.isCollapsed) {
      onSelect(null);
      return;
    }
    const range = selected.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
    const before = range.cloneRange();
    before.selectNodeContents(element);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    onSelect({ text: range.toString(), location: { ...location, start, end: start + range.toString().length } });
  };
  return (
    <div
      ref={root}
      tabIndex={0}
      onPointerUp={capture}
      onKeyUp={capture}
      onScroll={(event) => {
        const element = event.currentTarget;
        const box = element.getBoundingClientRect();
        const caret = document.caretPositionFromPoint?.(box.left + 25, box.top + 21);
        onPosition?.({
          view: 'TEXT',
          page: location.page,
          scrollTop: element.scrollTop,
          textOffset: caret?.offsetNode === element.firstChild ? caret.offset : undefined,
        });
      }}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words px-6 py-5 leading-relaxed outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      style={{ fontSize }}
    >
      {text}
    </div>
  );
}
