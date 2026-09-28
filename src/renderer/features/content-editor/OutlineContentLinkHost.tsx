import { createContext, useContext } from 'react';

export const OutlineContentLinkHost = createContext<{
  spaceId: string;
  articleId: string;
  albumId: string | null;
} | null>(null);
export const useOutlineContentLinkHost = () => useContext(OutlineContentLinkHost);
