import { useState, type ComponentProps } from 'react';
import type { AppLocation } from '@/renderer/components/app/app-navigation';
import { ContentSearchPreview } from '@/renderer/features/content-search/ContentSearchPreview';
import { ContentSearchView } from '@/renderer/features/content-search/ContentSearchView';
import { contentSearchSourceKey } from '@/renderer/features/content-search/contentSearchSelection';
import { useContentSearchSelection } from '@/renderer/features/content-search/useContentSearchSelection';
import { useContentSearchOpen } from '@/renderer/features/content-search/useContentSearchOpen';
import { useContentLookup } from '@/renderer/features/content-search/useContentLookup';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ContentSource } from '@/shared/contracts/content-source';

export default function ContentSearchScreen({
  active,
  location,
  onNavigate,
  onOpen,
  renderEditor,
}: {
  active: boolean;
  location: AppLocation['search'];
  onNavigate(location: AppLocation['search']): void;
  onOpen(source: ContentSource): void;
  renderEditor: ComponentProps<typeof ContentSearchPreview>['renderEditor'];
}) {
  const { messages } = useI18n();
  const { query, type } = location;
  const context = JSON.stringify([query, type]);
  const [composing, setComposing] = useState(false);
  const search = useContentLookup(contentLibraryApi(), query, type, active && !composing);
  const selection = useContentSearchSelection(active, context, messages.workbench.saveBeforeSwitch);
  const selectedKey = selection.selected ? contentSearchSourceKey(selection.selected.source) : undefined;
  const opening = useContentSearchOpen(
    active,
    `${context}:${selectedKey ?? ''}`,
    messages.referenceOutline.lookup.notAvailable,
    onOpen,
  );
  return (
    <ContentSearchView
      active={active}
      platform={window.desktopApi?.appPlatform ?? 'win32'}
      location={location}
      composing={composing}
      search={search}
      selection={selection}
      opening={opening}
      onComposing={setComposing}
      onNavigate={onNavigate}
      renderPreview={(visible) => (
        <ContentSearchPreview item={selection.selected} active={visible} renderEditor={renderEditor} />
      )}
    />
  );
}
