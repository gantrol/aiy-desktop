import type { Meta, StoryObj } from '@storybook/react-vite';
import { MediaSample } from '../component-lab/MediaSample';

const meta = {
  id: 'partial-media',
  title: 'Media/Media surface',
  component: MediaSample,
  args: { unavailable: false },
} satisfies Meta<typeof MediaSample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const M01: Story = { name: 'Portrait' };
export const M04: Story = { name: 'Unavailable', args: { unavailable: true } };
