import { createContext, useContext } from 'react';
import type { ContentSource } from '@/shared/contracts/content-source';
import type { ArticleDto } from '@/shared/contracts';
import type { OutlinePageCreateResult } from '@/shared/contracts/outline-page';

export interface ReferenceHost {
  source?: ContentSource;
  outline?: boolean;
  sharedEditor?: boolean;
  onAddComment?(): void;
  beforeCapture?(): Promise<ContentSource | null>;
  onTransferSaved?(article: ArticleDto): void;
  createOutlinePage?(operation: (source: ArticleDto) => Promise<OutlinePageCreateResult>): Promise<boolean>;
}

export const ContentReferenceHost = createContext<ReferenceHost>({});
export const useContentReferenceHost = () => useContext(ContentReferenceHost);
