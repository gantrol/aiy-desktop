import { LoaderCircleIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  open: boolean;
  title: string;
  onOpenChange(open: boolean): void;
  onSave(title: string): Promise<void>;
}

export function VideoDocumentRenameDialog({ open, title: savedTitle, onOpenChange, onSave }: Props) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments;
  const [title, setTitle] = useState(savedTitle);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle(savedTitle);
    setError('');
  }, [open, savedTitle]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(nextTitle);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : labels.editor.saveFailed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-w-sm">
        <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
          <DialogHeader>
            <DialogTitle>{labels.sidebar.rename}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="video-document-rename-title">{labels.documentTitle}</Label>
            <Input
              id="video-document-rename-title"
              autoFocus
              value={title}
              maxLength={300}
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
              {labels.editor.cancel}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <LoaderCircleIcon className="size-4 animate-spin" />}
              {saving ? labels.editor.saving : labels.editor.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
