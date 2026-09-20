import { createContext, useContext } from 'react';
import type { ContentSource } from '@/shared/contracts/content-source';

export interface ReferenceHost {
  source?: ContentSource;
  outline?: boolean;
  onAddComment?(): void;
  beforeCapture?(): Promise<ContentSource | null>;
}

export const ContentReferenceHost = createContext<ReferenceHost>({});
export const useContentReferenceHost = () => useContext(ContentReferenceHost);
