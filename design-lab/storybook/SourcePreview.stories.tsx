import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ContentSearchPreviewView } from '@/renderer/features/content-search/ContentSearchPreviewView';
import { SearchPreviewSample } from './SearchPreviewSample';
import { searchItems } from '../component-lab/searchSampleData';

type Args = { status: 'ready' | 'empty' | 'loading' | 'failed' };
function SourcePreview({ status }: Args) {
  const [failed, setFailed] = useState(status === 'failed');
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SearchPreviewSample
        item={status === 'empty' ? null : searchItems[0]}
        active
        failed={failed}
        loading={status === 'loading'}
        onRetry={() => setFailed(false)}
      />
    </div>
  );
}
const meta = {
  id: 'references-source',
  title: 'References/Source preview',
  component: ContentSearchPreviewView,
  args: { status: 'ready' },
  argTypes: { status: { control: 'select', options: ['ready', 'empty', 'loading', 'failed'] } },
  parameters: { controls: { include: ['status'] } },
  render: ({ status }) => <SourcePreview key={status} status={status} />,
} satisfies Meta<React.ComponentProps<typeof ContentSearchPreviewView> & Args>;
export default meta;
type Story = StoryObj<Args>;
export const Selected: Story = {};
export const Empty: Story = { args: { status: 'empty' } };
export const Loading: Story = { args: { status: 'loading' } };
export const Unavailable: Story = { args: { status: 'failed' } };
