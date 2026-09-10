import { LoaderCircleIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import type { ArticleDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  article: ArticleDto | null;
  open: boolean;
  onOpenChange(open: boolean): void;
  onSave(article: ArticleDto, title: string): Promise<void>;
}

export function RenameArticleDialog({ article, open, onOpenChange, onSave }: Props) {
  const { messages } = useI18n();
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !article) return;
    setTitle(article.content.title);
    setSaving(false);
    setError('');
  }, [article, open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!article || !nextTitle || saving) return;
    if (nextTitle === article.content.title) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(article, nextTitle);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-w-sm">
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{messages.creator.manuscriptEditor.renameTitle}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="article-rename-title">{messages.contentEditor.title}</Label>
            <Input
              id="article-rename-title"
              autoFocus
              value={title}
              maxLength={200}
              disabled={saving}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              {messages.common.cancel}
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving && <LoaderCircleIcon className="size-4 animate-spin" />}
              {saving ? messages.creator.manuscriptEditor.saving : messages.creator.rename.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
