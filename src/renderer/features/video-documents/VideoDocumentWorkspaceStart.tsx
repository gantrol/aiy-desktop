import { FileVideoIcon, FolderPlusIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';

type VideoDocumentLabels = ReturnType<typeof useI18n>['messages']['videoDocuments'];

interface Props {
  labels: VideoDocumentLabels;
  onStartVideoDocument(): void;
  onCreateAlbum(): void;
}

export function VideoDocumentWorkspaceStart({ labels, onStartVideoDocument, onCreateAlbum }: Props) {
  return (
    <div className="grid size-full place-items-center p-8">
      <div className="grid max-w-md justify-items-center gap-4 rounded-xl border border-dashed border-selected-border bg-selected/35 px-10 py-12 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-selected text-selected-foreground">
          <FileVideoIcon className="size-6" />
        </span>
        <div>
          <h2 className="font-semibold">{labels.start.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{labels.start.dropVideo}</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" onClick={onStartVideoDocument}>
            <FileVideoIcon className="size-4" />
            {labels.start.chooseVideo}
          </Button>
          <Button type="button" variant="outline" onClick={onCreateAlbum}>
            <FolderPlusIcon className="size-4" />
            {labels.sidebar.newAlbum}
          </Button>
        </div>
      </div>
    </div>
  );
}
