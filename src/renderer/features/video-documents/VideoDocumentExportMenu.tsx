import { FileTextIcon, FileType2Icon, LoaderCircleIcon, UploadIcon } from 'lucide-react';
import { useState } from 'react';
import type { VideoDocumentExportFormat } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { VideoDocumentToolbarAction } from '@/renderer/features/video-documents/VideoDocumentToolbar';

interface Props {
  disabled: boolean;
  exportingFormat: VideoDocumentExportFormat | null;
  labels: {
    action: string;
    markdown: string;
    word: string;
  };
  onExport(format: VideoDocumentExportFormat): void;
}

export function VideoDocumentExportMenu({ disabled, exportingFormat, labels, onExport }: Props) {
  const [open, setOpen] = useState(false);
  const busy = exportingFormat !== null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <VideoDocumentToolbarAction
          type="button"
          disabled={disabled || busy}
          icon={busy ? <LoaderCircleIcon className="size-4 animate-spin" /> : <UploadIcon className="size-4" />}
          label={labels.action}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1.5">
        <Button
          type="button"
          variant="ghost"
          className="h-8 w-full justify-start gap-2 px-2 font-normal"
          onClick={() => {
            setOpen(false);
            onExport('MARKDOWN');
          }}
        >
          <FileTextIcon className="size-3.5" />
          {labels.markdown}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 w-full justify-start gap-2 px-2 font-normal"
          onClick={() => {
            setOpen(false);
            onExport('DOCX');
          }}
        >
          <FileType2Icon className="size-3.5" />
          {labels.word}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
