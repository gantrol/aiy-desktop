import type { Meta, StoryObj } from '@storybook/react-vite';
import { ContentSearchView, type ContentSearchViewProps } from '@/renderer/features/content-search/ContentSearchView';
import { SearchPreviewSample } from './SearchPreviewSample';
import { useSearchScenario, searchScenarios, type SearchScenario } from './useSearchScenario';

type ScenarioArgs = { scenario: SearchScenario; platform: ContentSearchViewProps['platform'] };

function SearchStory({ scenario, platform }: ScenarioArgs) {
  const { previewFailed, retryPreview, ...state } = useSearchScenario(scenario);
  return (
    <ContentSearchView
      {...state}
      active
      platform={platform}
      renderPreview={(active) => (
        <SearchPreviewSample
          item={state.selection.selected}
          active={active}
          failed={previewFailed}
          onRetry={retryPreview}
        />
      )}
    />
  );
}

const meta = {
  id: 'contentsearch-workspace',
  title: 'Library/Search workspace',
  component: ContentSearchView,
  args: { scenario: 'results', platform: 'win32' },
  argTypes: {
    scenario: { control: 'select', options: searchScenarios },
    platform: { control: 'select', options: ['win32', 'darwin', 'linux'] },
  },
  parameters: { controls: { include: ['scenario', 'platform'] } },
  render: ({ scenario, platform }) => <SearchStory key={scenario} scenario={scenario} platform={platform} />,
} satisfies Meta<ContentSearchViewProps & ScenarioArgs>;
export default meta;
// The local host supplies production callbacks; stories specify only scenario inputs.
type Story = StoryObj<ScenarioArgs>;
export const Recent: Story = { args: { scenario: 'recent' } };
export const S02: Story = { name: 'Loading', args: { scenario: 'loading' } };
export const S03: Story = { name: 'Results' };
export const S04: Story = { name: 'Empty', args: { scenario: 'empty' } };
export const S05: Story = { name: 'Failed', args: { scenario: 'failed' } };
export const Selected: Story = { args: { scenario: 'selected' } };
export const PreviewFailed: Story = { args: { scenario: 'previewFailed' } };
export const NarrowResults: Story = { globals: { viewport: { value: 'aiyNarrow', isRotated: false } } };
export const NarrowSelected: Story = {
  args: { scenario: 'selected' },
  globals: { viewport: { value: 'aiyNarrow', isRotated: false } },
};
