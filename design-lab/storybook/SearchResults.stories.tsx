import type { ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ContentSearchResultList } from '@/renderer/features/content-search/ContentSearchResults';
import { contentSearchSourceKey } from '@/renderer/features/content-search/contentSearchSelection';
import { useSearchScenario, searchScenarios, type SearchScenario } from './useSearchScenario';

function ResultStory({ scenario }: { scenario: SearchScenario }) {
  const state = useSearchScenario(scenario);
  const selectedKey = state.selection.selected ? contentSearchSourceKey(state.selection.selected.source) : undefined;
  return (
    <div className="flex h-full max-w-md flex-col">
      <ContentSearchResultList
        query={state.location.query}
        search={state.search}
        selectedKey={selectedKey}
        onSelect={(item) => {
          void state.selection.select(item);
        }}
      />
    </div>
  );
}
const meta = {
  id: 'contentsearch-resultlist',
  title: 'Library/Search results',
  component: ContentSearchResultList,
  args: { scenario: 'results' },
  argTypes: { scenario: { control: 'select', options: searchScenarios } },
  parameters: { controls: { include: ['scenario'] } },
  render: ({ scenario }) => <ResultStory key={scenario} scenario={scenario} />,
} satisfies Meta<ComponentProps<typeof ContentSearchResultList> & { scenario: SearchScenario }>;
export default meta;
type Story = StoryObj<{ scenario: SearchScenario }>;
export const Loading: Story = { args: { scenario: 'loading' } };
export const Results: Story = {};
export const Empty: Story = { args: { scenario: 'empty' } };
export const Failed: Story = { args: { scenario: 'failed' } };
