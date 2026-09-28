import { createContext, useContext } from 'react';
import type { ContentSource } from '@/shared/contracts/content-source';
import type { ArticleDto } from '@/shared/contracts';

export interface ReferenceHost {
  source?: ContentSource;
  outline?: boolean;
  sharedEditor?: boolean;
  onAddComment?(): void;
  beforeCapture?(): Promise<ContentSource | null>;
  onTransferSaved?(article: ArticleDto): void;
}

export const ContentReferenceHost = createContext<ReferenceHost>({});
export const useContentReferenceHost = () => useContext(ContentReferenceHost);
