import { ArchiveRestoreIcon, EllipsisIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react';
import { useState } from 'react';
import type { TermEditorDto } from '@/shared/contracts';
import type { DictionaryMessages } from '@/renderer/i18n/catalog';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';

interface Props {
  copy: DictionaryMessages;
  detail: TermEditorDto;
  busy: boolean;
  dirty: boolean;
  onWithdraw(): void;
  onArchive(): void;
  onRestore(): void;
}

export function TermStateActions({ copy: c, detail, busy, dirty, onWithdraw, onArchive, onRestore }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const archived = detail.editorialState === 'ARCHIVED';
  const disabled = busy || dirty;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            data-action="term-state-actions"
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={c.moreActions}
            title={dirty ? c.saveBeforeStateChange : c.moreActions}
          >
            <EllipsisIcon className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="w-52 p-1.5">
          {archived ? (
            <Button
              data-action="term-restore"
              type="button"
              variant="ghost"
              className="w-full justify-start"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onRestore();
              }}
            >
              <ArchiveRestoreIcon className="size-4" />
              {c.restore}
            </Button>
          ) : (
            <>
              {detail.editorialState === 'APPROVED' && (
                <Button
                  data-action="term-withdraw"
                  type="button"
                  variant="ghost"
                  className="w-full justify-start"
                  disabled={disabled}
                  onClick={() => {
                    setOpen(false);
                    onWithdraw();
                  }}
                >
                  <RotateCcwIcon className="size-4" />
                  {c.withdrawApproval}
                </Button>
              )}
              <Button
                data-action="term-archive"
                type="button"
                variant="ghost"
                className="w-full justify-start text-destructive hover:text-destructive"
                disabled={disabled}
                onClick={() => {
                  setOpen(false);
                  setConfirmDelete(true);
                }}
              >
                <Trash2Icon className="size-4" />
                {c.deleteTerm}
              </Button>
            </>
          )}
          {dirty && <p className="px-2 py-1.5 text-xs text-muted-foreground">{c.saveBeforeStateChange}</p>}
        </PopoverContent>
      </Popover>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{c.deleteTerm}</DialogTitle>
            <DialogDescription>{c.deleteDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmDelete(false)}>
              {c.cancel}
            </Button>
            <Button
              data-action="term-archive-confirm"
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setConfirmDelete(false);
                onArchive();
              }}
            >
              {c.confirmDelete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
