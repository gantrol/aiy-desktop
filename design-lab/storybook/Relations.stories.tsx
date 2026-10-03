import type { Meta, StoryObj } from '@storybook/react-vite';
import { action } from 'storybook/actions';
import {
  CreationRelationsPreview,
  type CreationRelationItem,
} from '@/renderer/components/creator/CreationRelationsSheet';
import { useI18n } from '@/renderer/i18n/useI18n';

type Args = { empty: boolean; onSelect(item: CreationRelationItem): void };
const meta = {
  id: 'delivery-relations',
  title: 'Delivery/Related works',
  component: CreationRelationsPreview,
  args: { empty: false, onSelect: action('onSelect') },
  parameters: { controls: { include: ['empty'] } },
  render: function Render({ empty, onSelect }) {
    const copy = useI18n().messages;
    const items: CreationRelationItem[] = empty
      ? []
      : [
          {
            formId: 'sample-source',
            role: 'ARTICLE',
            direction: 'SOURCE',
            title: copy.designLab.storybook.sample.title,
            imageAssetIds: [],
          },
          {
            formId: 'sample-variant',
            role: 'SOCIAL_POST',
            direction: 'DERIVED',
            title: copy.creator.album.formKinds.SOCIAL_POST,
            imageAssetIds: [],
          },
        ];
    return (
      <div className="max-w-md p-4">
        <CreationRelationsPreview items={items} onSelect={onSelect} />
      </div>
    );
  },
} satisfies Meta<React.ComponentProps<typeof CreationRelationsPreview> & Args>;
export default meta;
type Story = StoryObj<Args>;
export const Default: Story = {};
export const Empty: Story = { args: { empty: true } };
