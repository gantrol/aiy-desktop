import { useEffect, useRef, useState } from 'react';
import type { ArticleInputRecord } from '@/shared/contracts/article-input-history';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/renderer/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useArticleEditorSession } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import type { ArticleInputHistoryActionProps } from '@/renderer/components/creator/article-editor/ArticleInputHistoryAction';
import { useArticleInputHistory } from '@/renderer/components/creator/article-editor/useArticleInputHistory';
import { ArticleInputRecordView } from '@/renderer/components/creator/article-editor/ArticleInputRecordView';

function InputRecordActions({
  record,
  onContinue,
  notify,
  setBusy,
}: Pick<ArticleInputHistoryActionProps, 'onContinue' | 'notify'> & {
  record: ArticleInputRecord;
  setBusy(busy: boolean): void;
}) {
  const copy = useI18n().messages.creator.inputHistory;
  const session = useArticleEditorSession();
  const [working, setWorking] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  const request = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function copyInput() {
    try {
      await navigator.clipboard.writeText(
        [record.snapshot.writingInstruction, record.snapshot.text, record.selectionText].filter(Boolean).join('\n\n'),
      );
      notify(copy.copied);
    } catch {
      notify(copy.copyFailed);
    }
  }

  async function continueInput() {
    if (request.current) return;
    request.current = true;
    setWorking(true);
    setBusy(true);
    const identity = session.getEditorSessionIdentity();
    try {
      if (!(await session.flush('manual')) || !active.current || identity !== session.getEditorSessionIdentity())
        return;
      const draft = await window.desktopApi.articleInputContinue({
        spaceId: record.spaceId,
        articleId: record.articleId,
        recordId: record.id,
        requestId: requestId.current,
      });
      if (!active.current || identity !== session.getEditorSessionIdentity()) return;
      if (!(await onContinue(draft.id))) notify(copy.openFailed);
    } catch (error) {
      notify(String(error).includes('ARTICLE_INPUT_MEDIA_UNAVAILABLE') ? copy.missingMedia : copy.continueFailed);
    } finally {
      request.current = false;
      if (active.current) {
        setWorking(false);
        setBusy(false);
      }
    }
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => void copyInput()}
        disabled={working || !(record.snapshot.text || record.snapshot.writingInstruction || record.selectionText)}
      >
        {copy.copy}
      </Button>
      <Button
        onClick={() => void continueInput()}
        disabled={working || !record.canContinue || record.missingReferenceIds.length > 0}
      >
        {working ? copy.creating : copy.continueCreation}
      </Button>
    </>
  );
}

export function ArticleInputHistoryDialog({
  articleId,
  spaceId,
  onContinue,
  notify,
  onClose,
  restoreFocus,
}: ArticleInputHistoryActionProps & { onClose(): void; restoreFocus(): void }) {
  const { locale, messages } = useI18n();
  const copy = messages.creator.inputHistory;
  const history = useArticleInputHistory(spaceId, articleId);
  const [busy, setBusy] = useState(false);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[85dvh] min-h-64 flex-col rounded-md sm:max-w-3xl"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{copy.originalInput}</DialogTitle>
        </DialogHeader>
        {history.items.length > 0 && (
          <div className="flex min-w-0 items-center gap-2">
            <Select value={history.selectedId ?? undefined} onValueChange={history.setSelectedId} disabled={busy}>
              <SelectTrigger className="min-w-0 flex-1" aria-label={copy.record}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {history.items.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {copy.kinds[item.kind]} · {dateFormat.format(new Date(item.createdAt))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {history.cursor && (
              <Button variant="ghost" disabled={busy || history.loading} onClick={() => void history.loadMore()}>
                {copy.more}
              </Button>
            )}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {history.failed || history.detailFailed ? (
            <div role="alert" className="flex items-center gap-2 text-sm">
              <span>{copy.loadFailed}</span>
              <Button variant="ghost" onClick={history.reload}>
                {copy.retry}
              </Button>
            </div>
          ) : history.record ? (
            <ArticleInputRecordView record={history.record} />
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {history.loading || history.selectedId ? copy.loading : copy.empty}
            </p>
          )}
        </div>
        {history.record && (
          <DialogFooter>
            <InputRecordActions
              key={history.record.id}
              record={history.record}
              onContinue={onContinue}
              notify={notify}
              setBusy={setBusy}
            />
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
