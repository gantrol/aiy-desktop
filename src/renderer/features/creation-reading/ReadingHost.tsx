import { createContext, useContext } from 'react';
import type { HtmlFileAttributes } from '@/shared/contracts/html-file';
import type { ReadingCitationLink } from '@/shared/reading-citation-link';

export const ReadingHost = createContext<{
  openHtml(file: HtmlFileAttributes): void;
  openReferences(trigger?: HTMLElement): void;
  closeReferences(): void;
  referencesOpen: boolean;
  openCitation(target: ReadingCitationLink, returnFocus: () => void): boolean;
} | null>(null);
export const useReadingHost = () => useContext(ReadingHost);
