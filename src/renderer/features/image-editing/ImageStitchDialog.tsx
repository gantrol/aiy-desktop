import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/renderer/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { StitchInput } from '@/renderer/features/image-editing/image-stitch.worker';

export function ImageStitchDialog({ onClose }: { onClose(): void }) {
  const l = useI18n().messages.desktopPetals.imageEditor;
  const c = l.stitch;
  const [files, setFiles] = useState<File[]>([]);
  const [layout, setLayout] = useState<StitchInput['layout']>('vertical');
  const [background, setBackground] = useState<StitchInput['background']>('transparent');
  const [gap, setGap] = useState(0);
  const [columns, setColumns] = useState(2);
  const [result, setResult] = useState<{ blob: Blob; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(crypto.randomUUID());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      worker.current?.terminate();
      worker.current = null;
    };
  }, []);
  useEffect(() => {
    if (result) return () => URL.revokeObjectURL(result.url);
  }, [result]);
  useEffect(() => {
    setResult(null);
    requestId.current = crypto.randomUUID();
  }, [files, layout, background, gap, columns]);
  const compose = () => {
    worker.current?.terminate();
    const next = new Worker(new URL('./image-stitch.worker.ts', import.meta.url), { type: 'module' });
    worker.current = next;
    setBusy(true);
    setError('');
    const fail = () => {
      if (worker.current !== next) return;
      next.terminate();
      worker.current = null;
      if (alive.current) {
        setBusy(false);
        setError(c.failed);
      }
    };
    const timeout = setTimeout(fail, 60_000);
    next.onerror = () => {
      clearTimeout(timeout);
      fail();
    };
    next.onmessage = (event: MessageEvent<{ blob?: Blob }>) => {
      clearTimeout(timeout);
      if (!event.data.blob) {
        fail();
        return;
      }
      next.terminate();
      worker.current = null;
      if (alive.current) {
        setResult({ blob: event.data.blob, url: URL.createObjectURL(event.data.blob) });
        setBusy(false);
      }
    };
    next.postMessage({ files, layout, background, gap, columns } satisfies StitchInput);
  };
  const move = (index: number, delta: number) =>
    setFiles((current) => {
      const next = [...current];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-auto" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{c.title}</DialogTitle>
        </DialogHeader>
        <Label className="grid gap-2">
          {c.files}
          <Input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            disabled={busy}
            onChange={(event) => {
              const next = Array.from(event.target.files ?? []);
              if (next.length > 16) setError(c.failed);
              else setFiles(next);
            }}
          />
        </Label>
        <div className="flex flex-wrap items-end gap-3">
          <Label className="grid gap-1">
            {c.layout}
            <Select value={layout} disabled={busy} onValueChange={(value) => setLayout(value as StitchInput['layout'])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['vertical', 'horizontal', 'grid'] as const).map((key) => (
                  <SelectItem key={key} value={key}>
                    {c[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label className="grid gap-1">
            {c.background}
            <Select
              value={background}
              disabled={busy}
              onValueChange={(value) => setBackground(value as StitchInput['background'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['transparent', 'white', 'black'] as const).map((key) => (
                  <SelectItem key={key} value={key}>
                    {c[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Label>
          <Label className="grid gap-1">
            {c.gap}
            <Input
              className="w-24"
              type="number"
              min={0}
              max={200}
              value={gap}
              disabled={busy}
              onChange={(event) => setGap(Number(event.target.value))}
            />
          </Label>
          {layout === 'grid' && (
            <Label className="grid gap-1">
              {c.columns}
              <Input
                className="w-24"
                type="number"
                min={1}
                max={4}
                value={columns}
                disabled={busy}
                onChange={(event) => setColumns(Number(event.target.value))}
              />
            </Label>
          )}
        </div>
        <StitchFileOrder
          files={files}
          busy={busy}
          onMove={move}
          onRemove={(index) => setFiles(files.filter((_, i) => i !== index))}
        />
        {result && (
          <img src={result.url} alt={c.preview} className="max-h-72 max-w-full justify-self-center object-contain" />
        )}
        {error && (
          <div role="alert" className="text-sm text-destructive">
            {error}
          </div>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            disabled={busy && !worker.current}
            onClick={() => {
              worker.current?.terminate();
              worker.current = null;
              onClose();
            }}
          >
            {l.cancel}
          </Button>
          <Button
            variant="outline"
            disabled={
              busy ||
              files.length < 2 ||
              gap < 0 ||
              gap > 200 ||
              !Number.isInteger(gap) ||
              !Number.isInteger(columns) ||
              columns < 1 ||
              columns > 4
            }
            onClick={compose}
          >
            {c.preview}
          </Button>
          <Button
            disabled={busy || !result}
            onClick={() => {
              if (!result) return;
              setBusy(true);
              setError('');
              void result.blob
                .arrayBuffer()
                .then((bytes) =>
                  window.desktopPetals.temporaryFiles({
                    kind: 'image',
                    requestId: requestId.current,
                    bytes: new Uint8Array(bytes),
                  }),
                )
                .then(onClose, () => {
                  if (alive.current) setError(l.failed);
                })
                .finally(() => {
                  if (alive.current) setBusy(false);
                });
            }}
          >
            {l.edit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StitchFileOrder({
  files,
  busy,
  onMove,
  onRemove,
}: {
  files: File[];
  busy: boolean;
  onMove(index: number, delta: number): void;
  onRemove(index: number): void;
}) {
  const l = useI18n().messages.desktopPetals.imageEditor;
  return (
    <ol className="max-h-40 overflow-auto divide-y">
      {files.map((file, index) => (
        <li key={`${index}-${file.name}`} className="flex items-center gap-1 py-1">
          <span className="min-w-0 flex-1 truncate text-sm">{file.name}</span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={l.stitch.up}
            disabled={busy || index === 0}
            onClick={() => onMove(index, -1)}
          >
            <ArrowUp />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={l.stitch.down}
            disabled={busy || index === files.length - 1}
            onClick={() => onMove(index, 1)}
          >
            <ArrowDown />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label={l.delete} disabled={busy} onClick={() => onRemove(index)}>
            <X />
          </Button>
        </li>
      ))}
    </ol>
  );
}
