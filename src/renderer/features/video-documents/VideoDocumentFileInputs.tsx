import type { RefObject } from 'react';

const videoFileAccept = 'video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov';

type VideoFileInputProps = {
  inputRef: RefObject<HTMLInputElement | null>;
} & ({ onSelect(file: File): void; onSelectFiles?: never } | { onSelectFiles(files: File[]): void; onSelect?: never });

export function VideoFileInput({ inputRef, onSelect, onSelectFiles }: VideoFileInputProps) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={videoFileAccept}
      multiple={Boolean(onSelectFiles)}
      className="hidden"
      onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        if (files.length && onSelectFiles) onSelectFiles(files);
        else if (files[0] && onSelect) onSelect(files[0]);
      }}
    />
  );
}

interface Props {
  createInputRef: RefObject<HTMLInputElement | null>;
  replacementInputRef: RefObject<HTMLInputElement | null>;
  onCreate(file: File): void;
  onReplace(file: File): void;
}

export function VideoDocumentFileInputs({ createInputRef, replacementInputRef, onCreate, onReplace }: Props) {
  return (
    <>
      <VideoFileInput inputRef={createInputRef} onSelect={onCreate} />
      <VideoFileInput inputRef={replacementInputRef} onSelect={onReplace} />
    </>
  );
}
