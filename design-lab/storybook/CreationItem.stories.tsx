import type { Meta, StoryObj } from '@storybook/react-vite';
import { action } from 'storybook/actions';
import { useState } from 'react';
import { FileTextIcon } from 'lucide-react';
import { CreationLibraryTreeItem } from '@/renderer/components/creator/CreationLibraryTreeItem';
import { CREATION_TREE_COMPACT_NODE_METRICS } from '@/renderer/components/albums/treeConnectionGeometry';
import { useI18n } from '@/renderer/i18n/useI18n';

type Args = { selected: boolean; onOpen?(): void };
function CreationItem({ selected: initial, onOpen }: Args) {
  const [selected, setSelected] = useState(initial);
  const copy = useI18n().messages;
  return (
    <div className="max-w-md p-4">
      <CreationLibraryTreeItem
        compact
        selected={selected}
        title={copy.designLab.storybook.sample.title}
        ariaLabel={copy.designLab.storybook.sample.title}
        openLabel={copy.designLab.storybook.sample.title}
        previewBounds={CREATION_TREE_COMPACT_NODE_METRICS.bounds}
        previewStyle={{ width: CREATION_TREE_COMPACT_NODE_METRICS.width, height: 36 }}
        preview={<FileTextIcon className="absolute top-1 left-7 size-7 text-muted-foreground" />}
        onOpen={() => {
          setSelected(true);
          onOpen?.();
        }}
      />
    </div>
  );
}
const meta = {
  id: 'library-item',
  title: 'Library/Content item',
  component: CreationLibraryTreeItem,
  args: { selected: false, onOpen: action('onOpen') },
  parameters: { controls: { include: ['selected'] } },
  render: (args) => <CreationItem key={String(args.selected)} {...args} />,
} satisfies Meta<React.ComponentProps<typeof CreationLibraryTreeItem> & Args>;
export default meta;
type Story = StoryObj<Args>;
export const Default: Story = {};
export const Selected: Story = { args: { selected: true } };
