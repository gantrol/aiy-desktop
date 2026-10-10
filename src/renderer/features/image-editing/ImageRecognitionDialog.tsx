import { useEffect, useRef, useState } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ImageEditDocument } from '@/shared/contracts/image-edit';
import { rasterImageEdit } from '@/renderer/features/image-editing/image-edit-raster';
import { recognizeImageQr } from '@/renderer/features/image-editing/image-qr';

export function ImageRecognitionDialog({
  mode,
  image,
  document,
  onClose,
}: {
  mode: 'ocr' | 'qr';
  image: HTMLImageElement;
  document: ImageEditDocument;
  onClose(): void;
}) {
  const { messages } = useI18n();
  const l = messages.desktopPetals.imageEditor;
  const [text, setText] = useState('');
  const [status, setStatus] = useState(l.recognition.scanning);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const noteRequest = useRef({ text: '', id: crypto.randomUUID() });
  useEffect(() => {
    const abort = new AbortController();
    const requestId = crypto.randomUUID();
    let dispatched = false;
    void (async () => {
      const blob = await rasterImageEdit(image, document, false, abort.signal);
      abort.signal.throwIfAborted();
      let value: string;
      if (mode === 'qr') value = await recognizeImageQr(blob, abort.signal);
      else {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        abort.signal.throwIfAborted();
        dispatched = true;
        const result = await window.desktopPetals.imagePrivacy({ kind: 'recognize', requestId, bytes });
        if (abort.signal.aborted) return;
        if (result.status !== 'ready') {
          setStatus(l.privacy[result.status]);
          return;
        }
        value = result.text ?? '';
      }
      if (!abort.signal.aborted) {
        setText(value);
        setStatus(value ? '' : l.recognition.empty);
      }
    })()
      .catch(() => {
        if (!abort.signal.aborted) setStatus(l.recognition.failed);
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => {
      abort.abort();
      if (dispatched) void window.desktopPetals.imagePrivacy({ kind: 'cancel', requestId }).catch(() => undefined);
    };
  }, [mode, image, document, l]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="max-w-2xl rounded-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{l.recognition[mode]}</DialogTitle>
        </DialogHeader>
        {status && (
          <div role="status" className="text-sm">
            {status}
          </div>
        )}
        <Textarea
          aria-label={l.recognition.result}
          value={text}
          disabled={busy || saving}
          maxLength={262144}
          rows={12}
          onChange={(event) => setText(event.target.value)}
        />
        <DialogFooter>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {messages.common.close}
          </Button>
          <Button
            variant="outline"
            disabled={busy || !text || saving}
            onClick={() =>
              void navigator.clipboard.writeText(text).then(
                () => setStatus(messages.clipboardCapture.copied),
                () => setStatus(l.copyFailed),
              )
            }
          >
            {messages.clipboardCapture.copy}
          </Button>
          <Button
            disabled={busy || !text.trim() || saving}
            onClick={() => {
              if (noteRequest.current.text !== text) noteRequest.current = { text, id: crypto.randomUUID() };
              setSaving(true);
              void window.desktopPetals
                .temporaryFiles({ kind: 'create', requestId: noteRequest.current.id, text })
                .then(onClose, () => setStatus(l.recognition.failed))
                .finally(() => setSaving(false));
            }}
          >
            {messages.clipboardCapture.tools.newNote}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
