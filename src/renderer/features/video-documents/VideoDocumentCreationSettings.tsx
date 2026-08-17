import { ArrowRightIcon, CaptionsIcon, FileTextIcon, LoaderCircleIcon, VideoIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { AlbumDto } from '@/shared/contracts';
import { CreateAlbumDialog } from '@/renderer/components/albums/CreateAlbumDialog';
import { SearchableAlbumSelect } from '@/renderer/components/albums/SearchableAlbumSelect';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Input } from '@/renderer/components/ui/input';
import { Label } from '@/renderer/components/ui/label';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  albums: readonly AlbumDto[];
  title: string;
  albumId: string | null;
  hasSource: boolean;
  openAfterCreate: boolean;
  canCreate: boolean;
  submitting: boolean;
  error: string;
  onTitleChange(value: string): void;
  onAlbumChange(value: string | null): void;
  onOpenAfterCreateChange(value: boolean): void;
  onCreateAlbum(title: string, parentAlbumId: string | null): Promise<AlbumDto>;
  onSubmit(): void | Promise<void>;
}

export function VideoDocumentCreationSettings({
  albums,
  title,
  albumId,
  hasSource,
  openAfterCreate,
  canCreate,
  submitting,
  error,
  onTitleChange,
  onAlbumChange,
  onOpenAfterCreateChange,
  onCreateAlbum,
  onSubmit,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.videoDocuments.start;
  const [createAlbumParent, setCreateAlbumParent] = useState<AlbumDto | null | undefined>(undefined);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (canCreate && !submitting) void onSubmit();
  }

  return (
    <form className="flex min-h-[360px] flex-col rounded-xl border bg-card p-5 shadow-sm" onSubmit={submit}>
      <h2 className="text-base font-semibold">{labels.creationSettings}</h2>
      <div className="mt-5 grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="video-document-creation-title">{labels.documentTitle}</Label>
          <Input
            id="video-document-creation-title"
            value={title}
            maxLength={300}
            placeholder={labels.titlePlaceholder}
            disabled={!hasSource || submitting}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label>{labels.destinationAlbum}</Label>
          <SearchableAlbumSelect
            albums={albums}
            value={albumId}
            disabled={submitting}
            labels={{
              ariaLabel: labels.destinationAlbum,
              unfiled: labels.unfiled,
              searchPlaceholder: labels.searchAlbums,
              empty: labels.noMatchingAlbums,
              create: messages.gallery.albums.create,
              createChild: messages.gallery.albums.createChild,
            }}
            onValueChange={onAlbumChange}
            onRequestCreate={setCreateAlbumParent}
          />
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded-md py-1 text-sm">
          <Checkbox
            checked={openAfterCreate}
            disabled={submitting}
            onCheckedChange={(checked) => onOpenAfterCreateChange(checked === true)}
          />
          <span>{labels.openTranscriptWorkspace}</span>
        </label>
      </div>

      <div className="mt-6 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 rounded-lg border bg-surface-sunken/60 px-3 py-5 text-center text-xs text-muted-foreground">
        <span className="grid justify-items-center gap-1.5">
          <VideoIcon className="size-5 text-accent-foreground" />
          {labels.workflowVideo}
        </span>
        <ArrowRightIcon className="size-4" />
        <span className="grid justify-items-center gap-1.5">
          <CaptionsIcon className="size-5 text-accent-foreground" />
          {labels.workflowTranscript}
        </span>
        <ArrowRightIcon className="size-4" />
        <span className="grid justify-items-center gap-1.5">
          <FileTextIcon className="size-5 text-accent-foreground" />
          {labels.workflowArticle}
        </span>
      </div>

      <div className="mt-auto pt-5">
        {error && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={!canCreate || submitting}>
          {submitting && <LoaderCircleIcon className="size-4 animate-spin" />}
          {submitting ? labels.creating : labels.create}
        </Button>
      </div>
      <CreateAlbumDialog
        open={createAlbumParent !== undefined}
        parentTitle={createAlbumParent?.title}
        busy={submitting}
        labels={{
          title: messages.gallery.albums.createTitle,
          childTitle: messages.gallery.albums.createChild,
          name: messages.gallery.albums.name,
          placeholder: messages.gallery.albums.namePlaceholder,
          cancel: messages.gallery.albums.cancel,
          create: messages.gallery.albums.create,
          operationFailed: messages.gallery.albums.operationFailed,
        }}
        onOpenChange={(open) => {
          if (!open) setCreateAlbumParent(undefined);
        }}
        onCreate={async (title) => {
          const created = await onCreateAlbum(title, createAlbumParent?.id ?? null);
          onAlbumChange(created.id);
        }}
      />
    </form>
  );
}
