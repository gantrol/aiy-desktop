import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { FilePenLineIcon, LoaderCircle, X } from 'lucide-react';
import type { CreatorScreenViewModel } from '@/renderer/components/creator/screen/creatorScreenViewModel';
import { useDocumentWriting } from '@/renderer/components/creator/workflows/useDocumentWriting';
import { useDocumentWritingSelection } from '@/renderer/components/creator/useDocumentWritingSelection';
import { documentWritingSelection } from '@/renderer/components/creator/documentWritingEditor';
import { DocumentWritingCandidate } from '@/renderer/components/creator/DocumentWritingCandidate';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Textarea } from '@/renderer/components/ui/textarea';
import { useI18n } from '@/renderer/i18n/useI18n';

export function DocumentWritingPanel({
  model,
  editor,
  materialsImporting,
}: {
  model: CreatorScreenViewModel;
  editor: Editor | null;
  materialsImporting: boolean;
}) {
  const { messages } = useI18n();
  const labels = messages.creator.documentWriting;
  const [open, setOpen] = useState(false);
  const [atSelection, setAtSelection] = useState(false);
  const [composing, setComposing] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const selection = useDocumentWritingSelection(editor, surface);
  const writing = useDocumentWriting(model, open, materialsImporting);
  const disabled = writing.busy || materialsImporting || composing;
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  function begin(nearSelection: boolean) {
    if (!writing.busy) writing.chooseKind(documentWritingSelection(editor) ? 'rewrite' : 'draft');
    setAtSelection(nearSelection);
    setOpen(true);
  }
  function dismiss() {
    selection.dismiss();
    setComposing(false);
    setOpen(false);
  }
  return (
    <Popover open={open || selection.visible} onOpenChange={(next) => (next ? begin(false) : dismiss())}>
      {(selection.visible || (open && atSelection)) && <PopoverAnchor virtualRef={selection.anchor} />}
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 gap-1.5 px-2"
          title={labels.title}
          aria-label={labels.title}
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            // The selection bubble is already open; this trigger still opens the full writing form.
            event.preventDefault();
            if (open) dismiss();
            else begin(selection.visible);
          }}
        >
          {writing.busy ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <FilePenLineIcon className="size-3.5" aria-hidden />
          )}
          <span>{labels.title}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        ref={surface}
        align="start"
        side="bottom"
        sideOffset={8}
        collisionPadding={12}
        aria-label={labels.title}
        className={
          open
            ? 'w-[26rem] max-w-[calc(100vw-1.5rem)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-3'
            : 'w-auto p-1'
        }
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          if (open) input.current?.focus();
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={() => {
          dismiss();
          editor?.commands.focus();
        }}
        onInteractOutside={(event) => {
          if (!open && event.target instanceof Node && editor?.view.dom.contains(event.target)) event.preventDefault();
        }}
      >
        {!open ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            disabled={materialsImporting}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => begin(true)}
          >
            <FilePenLineIcon className="size-3.5" aria-hidden />
            {labels.rewrite}
          </Button>
        ) : (
          <div className="space-y-3" aria-busy={writing.busy}>
            <header className="flex items-center gap-2">
              <FilePenLineIcon className="size-3.5 text-muted-foreground" aria-hidden />
              <span className="text-sm font-medium">{writing.kind === 'rewrite' ? labels.rewrite : labels.title}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="ml-auto size-7"
                aria-label={messages.common.close}
                onClick={() => {
                  dismiss();
                  editor?.commands.focus();
                }}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </header>
            {writing.kind === 'rewrite' ? (
              <blockquote
                aria-label={labels.selection}
                className="max-h-24 overflow-y-auto border-l-2 border-selected-border pl-3 text-sm text-muted-foreground whitespace-pre-wrap"
              >
                {writing.selectedText}
              </blockquote>
            ) : (
              <div className="flex items-center gap-1" role="group" aria-label={labels.title}>
                {(['draft', 'outline'] as const).map((kind) => (
                  <Button
                    key={kind}
                    variant={writing.kind === kind ? 'secondary' : 'ghost'}
                    size="sm"
                    aria-pressed={writing.kind === kind}
                    disabled={writing.busy}
                    onClick={() => writing.chooseKind(kind)}
                  >
                    {labels[kind]}
                  </Button>
                ))}
              </div>
            )}
            <Textarea
              ref={input}
              value={model.selection.writingInstruction}
              maxLength={8_000}
              aria-label={labels.instruction}
              placeholder={writing.kind === 'rewrite' ? labels.rewriteInstruction : labels.instruction}
              className="min-h-20 resize-none rounded-sm bg-surface"
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
              onChange={(event) => model.selection.setWritingInstruction(event.target.value)}
            />
            <div className="flex justify-end">
              <Button size="sm" disabled={disabled} onClick={() => void writing.generate()}>
                {writing.busy && <LoaderCircle className="size-3.5 animate-spin" aria-hidden />}
                {writing.busy ? labels.generating : labels.generate}
              </Button>
            </div>
            <DocumentWritingCandidate writing={writing} disabled={disabled} />
            {(writing.cursor || writing.historyFailed) && (
              <Button
                size="sm"
                variant="ghost"
                disabled={writing.loading}
                onClick={() => void writing.loadHistory(writing.cursor)}
              >
                {writing.historyFailed ? labels.retryHistory : labels.earlier}
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
