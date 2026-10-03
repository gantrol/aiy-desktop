import type { ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CollectionDetailLayout } from '@/renderer/components/workbench/CollectionDetailLayout';
import { WorkbenchPaneHeader } from '@/renderer/components/workbench/WorkbenchPane';
import { ContentSearchResultList } from '@/renderer/features/content-search/ContentSearchResults';
import { contentSearchSourceKey } from '@/renderer/features/content-search/contentSearchSelection';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useSearchScenario } from './useSearchScenario';
import { SearchPreviewSample } from './SearchPreviewSample';

type LayoutArgs = Pick<ComponentProps<typeof CollectionDetailLayout>, 'collectionWidth' | 'minimumDetailWidth'> & {
  initiallySelected: boolean;
};

function LayoutStory({ initiallySelected, ...sizes }: LayoutArgs) {
  const { messages } = useI18n();
  const state = useSearchScenario(initiallySelected ? 'selected' : 'results');
  const item = state.selection.selected;
  const selectedKey = item ? contentSearchSourceKey(item.source) : undefined;
  return (
    <CollectionDetailLayout
      {...sizes}
      layoutKey="content-search"
      collectionLabel={messages.referenceOutline.lookup.results}
      selectionKey={selectedKey ?? null}
      collection={({ toggle, revealDetail }) => (
        <>
          <WorkbenchPaneHeader>
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
              {messages.referenceOutline.lookup.results}
            </h2>
            {toggle}
          </WorkbenchPaneHeader>
          <ContentSearchResultList
            query={state.location.query}
            search={state.search}
            selectedKey={selectedKey}
            onSelect={(item) => {
              void state.selection.select(item).then(() => revealDetail());
            }}
          />
        </>
      )}
    >
      {({ toggle, visible }) => (
        <>
          <WorkbenchPaneHeader>
            {toggle}
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
              {item?.title ?? messages.workbench.preview}
            </h2>
          </WorkbenchPaneHeader>
          <SearchPreviewSample item={item} active={visible} failed={state.previewFailed} onRetry={state.retryPreview} />
        </>
      )}
    </CollectionDetailLayout>
  );
}

const meta = {
  id: 'workbench-collectiondetaillayout',
  title: 'Interface/List and detail',
  component: CollectionDetailLayout,
  subcomponents: { WorkbenchPaneHeader },
  args: { collectionWidth: 360, minimumDetailWidth: 480, initiallySelected: false },
  parameters: { controls: { include: ['collectionWidth', 'minimumDetailWidth', 'initiallySelected'] } },
  render: ({ initiallySelected, collectionWidth, minimumDetailWidth }) => (
    <LayoutStory
      key={String(initiallySelected)}
      initiallySelected={initiallySelected}
      collectionWidth={collectionWidth}
      minimumDetailWidth={minimumDetailWidth}
    />
  ),
} satisfies Meta<ComponentProps<typeof CollectionDetailLayout> & LayoutArgs>;
export default meta;
type Story = StoryObj<LayoutArgs>;
export const Results: Story = {};
export const Selected: Story = { args: { initiallySelected: true } };
export const NarrowResults: Story = { globals: { viewport: { value: 'aiyNarrow', isRotated: false } } };
export const NarrowSelected: Story = {
  args: { initiallySelected: true },
  globals: { viewport: { value: 'aiyNarrow', isRotated: false } },
};
