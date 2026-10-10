import type { ReactNode } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Separator } from '@/renderer/components/ui/separator';
import { cn } from '@/renderer/lib/utils';
import { ReadingHost } from '@/renderer/features/creation-reading/ReadingHost';
import { ReadingInputPane } from '@/renderer/features/creation-reading/ReadingInputPane';
import { useCreationReadingWorkspace } from '@/renderer/features/creation-reading/useCreationReadingWorkspace';

export function CreationReadingWorkspace({ children, spaceId }: { children: ReactNode; spaceId: string }) {
  const workspace = useCreationReadingWorkspace(spaceId);
  const { copy, root, dragging, effectiveLayout, split, showOutput, error, setError, host, ratio, changeRatio } =
    workspace;
  return (
    <ReadingHost value={host}>
      <section className="flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-background" data-creation-reading>
        {error && (
          <div role="alert" className="flex shrink-0 items-center gap-2 border-b px-3 py-1 text-xs text-destructive">
            {error}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setError('')}>
              {copy.close}
            </Button>
          </div>
        )}
        <div
          ref={root}
          className={cn(
            'relative flex min-h-0 min-w-0 flex-1 overflow-hidden',
            effectiveLayout === 'VERTICAL' ? 'flex-col' : 'flex-row',
          )}
        >
          <ReadingInputPane workspace={workspace} />
          {split && (
            <Separator
              decorative={false}
              orientation={effectiveLayout === 'VERTICAL' ? 'horizontal' : 'vertical'}
              role="separator"
              tabIndex={0}
              aria-label={copy.resize}
              aria-valuemin={25}
              aria-valuemax={75}
              aria-valuenow={ratio}
              className={cn(
                'z-10 shrink-0 touch-none bg-border focus-visible:bg-primary focus-visible:outline-none',
                effectiveLayout === 'VERTICAL' ? 'h-1 cursor-row-resize' : 'w-1 cursor-col-resize',
              )}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.preventDefault();
                dragging.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                if (!dragging.current || !root.current) return;
                const box = root.current.getBoundingClientRect();
                changeRatio(
                  effectiveLayout === 'VERTICAL'
                    ? ((event.clientY - box.top) / box.height) * 100
                    : ((event.clientX - box.left) / box.width) * 100,
                );
              }}
              onPointerUp={() => {
                dragging.current = false;
              }}
              onPointerCancel={() => {
                dragging.current = false;
              }}
              onLostPointerCapture={() => {
                dragging.current = false;
              }}
              onDoubleClick={() => changeRatio(50)}
              onKeyDown={(event) => {
                const forward = effectiveLayout === 'VERTICAL' ? 'ArrowDown' : 'ArrowRight',
                  backward = effectiveLayout === 'VERTICAL' ? 'ArrowUp' : 'ArrowLeft';
                if (event.key === forward || event.key === backward || event.key === 'Home') {
                  event.preventDefault();
                  changeRatio(event.key === 'Home' ? 50 : ratio + (event.key === forward ? 5 : -5));
                }
              }}
            />
          )}
          <div
            className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', !showOutput && 'hidden')}
            inert={!showOutput}
          >
            {children}
          </div>
        </div>
      </section>
    </ReadingHost>
  );
}
