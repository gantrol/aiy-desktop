import { LoaderCircleIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Locale, TermEditorDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';

interface Props {
  locale: Locale;
  open: boolean;
  classificationId?: string | null;
  classificationPath?: string | null;
  onOpenChange(open: boolean): void;
  onCreated(term: TermEditorDto): void;
}

export function NewTermDialog({ locale, open, classificationId, classificationPath, onOpenChange, onCreated }: Props) {
  const { messages } = useI18n();
  const l = messages.dictionary.newTerm;
  const [title, setTitle] = useState('');
  const [titleLocale, setTitleLocale] = useState<string>(locale);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle('');
      setTitleLocale(locale);
      setError('');
    }
  }, [locale, open]);

  async function create() {
    if (!title.trim()) {
      setError(l.required);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const term = await window.desktopApi.dictionaryCreate({
        title,
        titleLocale,
        uiLocale: locale,
        classificationId,
      });
      onCreated(term);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-dialog="new-term">
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <DialogHeader>
            <DialogTitle>{classificationPath ? l.titleInClassification(classificationPath) : l.title}</DialogTitle>
            <DialogDescription className="sr-only">{l.description}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            {classificationPath && (
              <div className="grid gap-1.5 text-xs text-muted-foreground">
                <span>{l.classification}</span>
                <strong className="truncate rounded-md border bg-surface-sunken px-3 py-2 font-medium text-foreground">
                  {classificationPath}
                </strong>
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="new-term-title" className="text-xs text-muted-foreground">
                {l.titleField}
              </Label>
              <Input id="new-term-title" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-term-locale" className="text-xs text-muted-foreground">
                {l.titleLanguage}
              </Label>
              <Input
                id="new-term-locale"
                value={titleLocale}
                onChange={(event) => setTitleLocale(event.target.value)}
                placeholder={locale}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {l.cancel}
            </Button>
            <Button data-action="dictionary-new-submit" type="submit" disabled={busy} aria-busy={busy}>
              {busy && <LoaderCircleIcon className="size-4 animate-spin" />}
              {l.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
