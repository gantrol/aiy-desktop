import type { useDerivedVisualOperations } from '@/renderer/components/creator/useDerivedVisualOperations';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { DerivedVisualOperationComparison } from '@/renderer/components/creator/DerivedVisualOperationComparison';

export function DerivedVisualOperationHistory({
  controller,
}: {
  controller: ReturnType<typeof useDerivedVisualOperations>;
}) {
  const copy = useI18n().messages.creator.derivedVisual.adoption;
  return (
    <div className="mt-2 grid gap-2 text-xs">
      {controller.loading && <p role="status">{copy.loading}</p>}
      {controller.error && (
        <div role="alert" className="grid gap-1 text-destructive">
          <p>{controller.error}</p>
          <Button size="sm" variant="outline" onClick={() => void controller.reload()}>
            {copy.reload}
          </Button>
        </div>
      )}
      {controller.unknown && (
        <div role="alert" className="grid gap-2 rounded border p-2">
          <p>{copy.unknown}</p>
          <div className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={controller.busy}
              onClick={() => void controller.check(controller.unknown!)}
            >
              {copy.check}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={controller.busy}
              onClick={() => void controller.retry(controller.unknown!)}
            >
              {copy.retry}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={controller.busy}
              onClick={() => void controller.cancel(controller.unknown!)}
            >
              {copy.cancel}
            </Button>
          </div>
        </div>
      )}
      {controller.operations.some((operation) => operation.status === 'PENDING') && (
        <p role="status">{copy.pendingHelp}</p>
      )}
      <details
        open={controller.operations.some(
          (operation) => operation.status === 'PENDING' || operation.status === 'CONFLICT',
        )}
      >
        <summary className="cursor-pointer">{copy.history}</summary>
        <div className="mt-2 grid max-h-64 gap-2 overflow-auto">
          {!controller.loading && !controller.operations.length && (
            <p className="text-muted-foreground">{copy.empty}</p>
          )}
          {controller.operations.map((operation) => (
            <div key={operation.request.requestId} className="grid gap-1 rounded border p-2">
              <span>
                {operation.request.kind === 'UNDO' ? copy.undo : copy.intents[operation.request.intent]} ·{' '}
                {operation.undoneByRequestId ? copy.undone : copy.statuses[operation.status]}
              </span>
              <time className="text-muted-foreground">{operation.createdAt}</time>
              <div className="flex flex-wrap gap-1">
                {operation.status !== 'PENDING' && operation.status !== 'CANCELLED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void controller.inspect(operation.request.requestId)}
                  >
                    {copy.compare}
                  </Button>
                )}
                {operation.status === 'PENDING' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={controller.busy}
                      onClick={() => void controller.retry(operation.request)}
                    >
                      {copy.retry}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={controller.busy}
                      onClick={() => void controller.cancel(operation.request)}
                    >
                      {copy.cancel}
                    </Button>
                  </>
                )}
                {operation.status === 'SUCCEEDED' &&
                  operation.request.kind === 'ADOPT' &&
                  operation.resultRevisionId !== operation.beforeRevisionId &&
                  !operation.undoneByRequestId && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={controller.blocked}
                      onClick={() => controller.undo(operation)}
                    >
                      {copy.undo}
                    </Button>
                  )}
              </div>
            </div>
          ))}
          {controller.loadMore && (
            <Button
              size="sm"
              variant="ghost"
              disabled={controller.loading}
              onClick={() => void controller.loadMore?.()}
            >
              {copy.older}
            </Button>
          )}
        </div>
      </details>
      <DerivedVisualOperationComparison controller={controller} />
    </div>
  );
}
