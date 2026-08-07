import { useEffect, useState } from 'react';
import { LoaderCircleIcon, TextCursorInputIcon } from 'lucide-react';
import type { PromptSeriesDto } from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';

interface Props {
  series: PromptSeriesDto | undefined;
  prompt: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSaved(): Promise<void>;
  notify(message: string): void;
}

export function RenameSeriesDialog({ series, prompt, open, onOpenChange, onSaved, notify }: Props) {
  const { messages } = useI18n();
  const c = messages.creator.rename;
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState<'suggest' | 'save' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !series) return;
    setTitle(series.title);
    setBusy(null);
    setError('');
  }, [open, series]);

  if (!series) return null;
  const currentSeries = series;

  async function suggest() {
    setBusy('suggest');
    setError('');
    try {
      const result = await window.desktopApi.codexSuggestTitles({
        prompt,
        title,
        mode: 'regenerate',
      });
      setTitle(result.title);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy('save');
    setError('');
    try {
      await window.desktopApi.promptSeriesRename({ seriesId: currentSeries.id, title });
      await onSaved();
      onOpenChange(false);
      notify(c.saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-dialog="rename-series" className="max-w-md">
        <DialogHeader>
          <DialogTitle>{c.title}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="series-title">{c.fieldLabel}</Label>
            <Input id="series-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={Boolean(busy) || !prompt.trim()}
            onClick={() => void suggest()}
          >
            {busy === 'suggest' ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <TextCursorInputIcon className="size-4" />
            )}
            {c.suggest}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {c.cancel}
            </Button>
            <Button
              data-action="rename-series-submit"
              type="button"
              disabled={Boolean(busy) || !title.trim()}
              aria-busy={busy === 'save'}
              onClick={() => void save()}
            >
              {busy === 'save' && <LoaderCircleIcon className="size-4 animate-spin" />}
              {c.save}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
