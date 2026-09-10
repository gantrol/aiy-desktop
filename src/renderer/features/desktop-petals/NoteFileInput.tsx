import type { Ref } from 'react';
import { Input } from '@/renderer/components/ui/input';
import { Button } from '@/renderer/components/ui/button';
import { X } from 'lucide-react';
import { useI18n } from '@/renderer/i18n/useI18n';

export function NoteFileInput({
  inputRef,
  onFiles,
  progress,
  onCancel,
}: {
  inputRef: Ref<HTMLInputElement>;
  onFiles(files: File[]): Promise<boolean>;
  progress: { completed: number; total: number } | null;
  onCancel(): void;
}) {
  const copy = useI18n().messages.desktopPetals.files;
  return (
    <>
      <Input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        aria-label={copy.choose}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          if (files.length) void onFiles(files);
        }}
      />
      {progress && (
        <div className="flex shrink-0 items-center gap-1 px-3 text-xs">
          <span role="status">
            {copy.progress
              .replace('{completed}', String(progress.completed))
              .replace('{total}', String(progress.total))}
          </span>
          <Button size="icon-sm" variant="ghost" aria-label={copy.cancel} title={copy.cancel} onClick={onCancel}>
            <X className="size-3.5" />
          </Button>
        </div>
      )}
    </>
  );
}
