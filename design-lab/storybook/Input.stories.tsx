import type { Meta, StoryObj } from '@storybook/react-vite';
import { Input } from '@/renderer/components/ui/input';
import { InputOverview } from './FoundationOverview';
import { InputExample, inputExamples, type InputSampleArgs } from './FoundationSamples';

const meta = {
  id: 'ui-input',
  title: 'Interface/Input',
  component: Input,
  args: inputExamples.empty.args,
  parameters: { controls: { include: ['disabled', 'readOnly', 'filled', 'defaultValue'] } },
  argTypes: { filled: { control: 'boolean' }, defaultValue: { control: 'text' } },
  render: (args) => (
    <div className="max-w-md p-4">
      <InputExample {...args} />
    </div>
  ),
} satisfies Meta<InputSampleArgs>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Overview: Story = {
  name: 'State overview',
  parameters: { controls: { disable: true } },
  render: () => <InputOverview />,
};
export const Empty: Story = { name: 'Empty input' };
export const Filled: Story = { args: inputExamples.filled.args };
export const Disabled: Story = { args: inputExamples.disabled.args };
export const ReadOnly: Story = { name: 'Read only', args: inputExamples.readOnly.args };
