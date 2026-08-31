import type { ReactNode, RefObject } from 'react';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';
import { useArticleEditorSplitPane } from '@/renderer/components/creator/article-editor/useArticleEditorSplitPane';

interface Props {
  left: ReactNode;
  leftRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  right: ReactNode;
  rightRef: RefObject<HTMLDivElement | null>;
  zh: boolean;
}

export function ArticleEditorSplit({ left, leftRef, open, right, rightRef, zh }: Props) {
  const split = useArticleEditorSplitPane();
  return (
    <div ref={split.containerRef} className="@container/creator flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div
        ref={leftRef}
        className={
          open ? 'flex min-h-0 min-w-0 shrink-0 overflow-hidden' : 'flex min-h-0 min-w-0 flex-1 overflow-hidden'
        }
        style={open ? { width: split.primaryWidth || '50%' } : undefined}
      >
        {left}
      </div>
      {open && (
        <div ref={rightRef} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden border-l">
          <CreatorPaneResizeHandle
            edge="left"
            label={zh ? '调整分屏宽度' : 'Resize panes'}
            value={split.primaryWidth}
            min={split.minimum}
            max={split.maximum}
            valueText={`${Math.round(split.primaryWidth)}px`}
            onPointerDown={split.beginResize}
            onValueChange={split.setPrimaryWidth}
          />
          {right}
        </div>
      )}
    </div>
  );
}
