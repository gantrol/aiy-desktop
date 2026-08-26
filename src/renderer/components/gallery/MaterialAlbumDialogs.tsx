import { useEffect, useState, type FormEvent } from 'react';
import type { MaterialAlbumDto } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Input } from '@/renderer/components/ui/input';

export type MaterialAlbumEditorState =
  { mode: 'create'; parent: MaterialAlbumDto | null } | { mode: 'rename'; album: MaterialAlbumDto };

interface Labels {
  create: string;
  createTitle: string;
  renameTitle: string;
  deleteTitle: string;
  deleteDescription(title: string): string;
  name: string;
  namePlaceholder: string;
  cancel: string;
  save: string;
  confirmDelete: string;
  operationFailed: string;
}

interface Props {
  editor: MaterialAlbumEditorState | null;
  labels: Labels;
  busy: boolean;
  onEditorChange(editor: MaterialAlbumEditorState | null): void;
  onCreate(title: string, parentAlbumId: string | null): Promise<void>;
  onRename(album: MaterialAlbumDto, title: string): Promise<void>;
}

export function MaterialAlbumDialogs({ editor, labels, busy, onEditorChange, onCreate, onRename }: Props) {
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTitle(editor?.mode === 'rename' ? editor.album.title : '');
    setError('');
  }, [editor]);

  async function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!editor || !nextTitle || busy || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      if (editor.mode === 'create') await onCreate(nextTitle, editor.parent?.id ?? null);
      else await onRename(editor.album, nextTitle);
      onEditorChange(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : labels.operationFailed);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={Boolean(editor)} onOpenChange={(open) => !open && !submitting && onEditorChange(null)}>
      <DialogContent
        data-dialog="material-album-editor"
        data-editor-mode={editor?.mode ?? ''}
        data-operation-state={submitting || busy ? 'pending' : 'idle'}
        aria-busy={submitting || busy}
      >
        <form className="grid gap-4" onSubmit={(event) => void submitEditor(event)}>
          <DialogHeader>
            <DialogTitle>{editor?.mode === 'rename' ? labels.renameTitle : labels.createTitle}</DialogTitle>
          </DialogHeader>
          <label className="grid gap-2 text-sm font-medium">
            {labels.name}
            <Input
              autoFocus
              data-field="material-album-name"
              value={title}
              maxLength={120}
              disabled={busy || submitting}
              placeholder={labels.namePlaceholder}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onEditorChange(null)}>
              {labels.cancel}
            </Button>
            <Button
              type="submit"
              data-action="material-album-submit"
              aria-busy={submitting}
              disabled={busy || submitting || !title.trim()}
            >
              {editor?.mode === 'rename' ? labels.save : labels.create}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
