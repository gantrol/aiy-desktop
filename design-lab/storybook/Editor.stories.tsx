import type { Meta, StoryObj } from '@storybook/react-vite';
import { EditorSample } from '../component-lab/EditorSample';

const meta = {
  id: 'partial-editor',
  title: 'Creation/Body editor',
  component: EditorSample,
  args: { blank: false },
} satisfies Meta<typeof EditorSample>;
export default meta;
type Story = StoryObj<typeof meta>;
export const E01: Story = { name: 'Blank', args: { blank: true } };
export const E02: Story = { name: 'Existing draft' };
export const ReadOnly: Story = { name: 'Read only', args: { readOnly: true } };
