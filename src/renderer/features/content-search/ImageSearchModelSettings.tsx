import { useState } from 'react';
import { SettingsIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ImageSearchModelConfiguration } from '@/renderer/features/content-search/ImageSearchModelConfiguration';
import { VideoSearchAccess } from '@/renderer/features/content-search/VideoSearchAccess';

export function ImageSearchModelSettings({ onClose, video = false }: { onClose(): void; video?: boolean }) {
  const [open, setOpen] = useState(false);
  const copy = useI18n().messages.imageSearch;
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        title={copy.configure}
        aria-label={copy.configure}
        onClick={() => setOpen(true)}
      >
        <SettingsIcon className="size-4" />
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) onClose();
        }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{copy.configure}</DialogTitle>
          </DialogHeader>
          <ImageSearchModelConfiguration active={open} />
          {video && <VideoSearchAccess active={open} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
