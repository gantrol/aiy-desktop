import { createContext, useContext, type ComponentType } from 'react';
import type { ContentSource } from '@/shared/contracts/content-library';
import type { LinkCardApplication, LinkCardAttributes } from '@/shared/contracts/link-card';

export interface ContentLinkAction {
  id: string;
  label: string;
  application?: LinkCardApplication;
}

export type ContentLinkCardProps = LinkCardAttributes & { source?: ContentSource };

export interface ContentLinkProvider {
  id: string;
  matches(url: string): boolean;
  parsePaste(text: string): LinkCardAttributes[] | null;
  actions(source?: ContentSource): readonly ContentLinkAction[];
  Card: ComponentType<ContentLinkCardProps>;
}

/** Hosts supply enabled extension contributions; the editor does not discover or activate plugins. */
export const ContentLinkProviders = createContext<readonly ContentLinkProvider[]>([]);
export const ContentLinkSource = createContext<ContentSource | undefined>(undefined);
export const useContentLinkSource = () => useContext(ContentLinkSource);
export const useContentLinkProviders = () => useContext(ContentLinkProviders);
