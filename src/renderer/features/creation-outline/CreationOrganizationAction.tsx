import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileTextIcon, LoaderCircleIcon, PlusIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { openAppContentLink } from '@/renderer/components/app/app-content-link';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  spaceId: string;
  target: { kind: 'album'; id: string; title: string } | { kind: 'creation'; id: string; title: string };
  busy: boolean;
  refresh(): Promise<void>;
  onError(message: string): void;
  renderTrigger?(action: { disabled: boolean; onClick(): void }): ReactNode;
}

export function CreationOrganizationAction({ spaceId, target, busy, refresh, onError, renderTrigger }: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.outline;
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [format, setFormat] = useState<'MANUSCRIPT' | 'OUTLINE'>('MANUSCRIPT');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current += 1;
    return () => {
      epoch.current += 1;
    };
  }, [spaceId, target.kind, target.id]);
  const [error, setError] = useState('');
  const attempt = useRef<{ title: string; format: string; id: string } | null>(null);
  const caption = target.kind === 'album' ? labels.albumNote : labels.createChild;

  async function execute() {
    if (busy || pendingRef.current) return;
    if (target.kind === 'creation' && !title.trim()) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    const requestEpoch = epoch.current;
    const current = () => epoch.current === requestEpoch;
    try {
      if (!attempt.current || attempt.current.title !== title.trim() || attempt.current.format !== format)
        attempt.current = { title: title.trim(), format, id: crypto.randomUUID() };
      const result = await window.desktopApi.creationOrganizationCommand(
        target.kind === 'album'
          ? { kind: 'album-note', spaceId, albumId: target.id, title: target.title.slice(0, 200) || labels.albumNote }
          : {
              kind: 'create-child',
              spaceId,
              parentCreationItemId: target.id,
              title: title.trim(),
              format,
              requestId: attempt.current.id,
            },
      );
      if (!current()) return;
      if (result.kind === 'error') {
        const message = result.code === 'FAILED' ? labels.organizationFailed : labels.errors[result.code];
        if (target.kind === 'album') onError(message);
        else setError(message);
        return;
      }
      await refresh().catch(() => {
        if (current()) onError(labels.refreshFailed);
      });
      if (!current()) return;
      if (!openAppContentLink(result.link.url)) {
        onError(labels.errors.UNAVAILABLE);
        return;
      }
      setOpen(false);
      setTitle('');
      attempt.current = null;
    } catch {
      if (!current()) return;
      if (target.kind === 'album') onError(labels.organizationFailed);
      else setError(labels.organizationFailed);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  const action = {
    disabled: busy || pending,
    onClick: () => {
      if (target.kind === 'album') void execute();
      else {
        setError('');
        setOpen(true);
      }
    },
  };
  return (
    <>
      {renderTrigger ? (
        renderTrigger(action)
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy || pending}
          title={caption}
          aria-label={caption}
          onClick={action.onClick}
        >
          {pending ? (
            <LoaderCircleIcon className="size-3.5 animate-spin" />
          ) : target.kind === 'album' ? (
            <FileTextIcon className="size-3.5" />
          ) : (
            <PlusIcon className="size-3.5" />
          )}
        </Button>
      )}
      {open && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!pending) setOpen(next);
          }}
        >
          <DialogContent
            className="max-w-md gap-4 rounded-md"
            aria-describedby={undefined}
            onEscapeKeyDown={(event) => {
              if (pending) event.preventDefault();
            }}
          >
            <DialogHeader>
              <DialogTitle>{labels.createChild}</DialogTitle>
            </DialogHeader>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void execute();
              }}
            >
              <Label className="grid gap-2">
                {messages.gallery.albums.name}
                <Input
                  autoFocus
                  value={title}
                  maxLength={200}
                  disabled={pending}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </Label>
              <Select value={format} disabled={pending} onValueChange={(value) => setFormat(value as typeof format)}>
                <SelectTrigger aria-label={labels.childFormat}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANUSCRIPT">{labels.manuscript}</SelectItem>
                  <SelectItem value="OUTLINE">{labels.writingOutline}</SelectItem>
                </SelectContent>
              </Select>
              {error && (
                <div role="alert" className="text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
                  {messages.common.cancel}
                </Button>
                <Button type="submit" disabled={busy || pending || !title.trim()}>
                  {pending && <LoaderCircleIcon className="size-4 animate-spin" />}
                  {labels.createChild}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
