import type { RefObject } from 'react';

const videoFileAccept = 'video/mp4,video/webm,video/quicktime,.mp4,.m4v,.webm,.mov';

interface VideoFileInputProps {
  inputRef: RefObject<HTMLInputElement | null>;
  onSelect(file: File): void;
}

export function VideoFileInput({ inputRef, onSelect }: VideoFileInputProps) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={videoFileAccept}
      className="hidden"
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file) onSelect(file);
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
