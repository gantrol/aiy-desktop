import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@/renderer/components/ui/button';
import { ButtonOverview } from './FoundationOverview';
import { ButtonExample, buttonDisabledArgs, buttonExamples, buttonIconArgs, buttonSizes } from './FoundationSamples';

const meta = {
  id: 'ui-button',
  title: 'Interface/Button',
  component: Button,
  args: buttonExamples.primary.args,
  parameters: { controls: { include: ['variant', 'size', 'disabled'] } },
  argTypes: {
    variant: { control: 'select', options: Object.values(buttonExamples).map(({ args }) => args.variant) },
    size: { control: 'select', options: buttonSizes },
  },
  render: (args) => (
    <div className="p-4">
      <ButtonExample {...args} />
    </div>
  ),
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Overview: Story = {
  name: 'State overview',
  parameters: { controls: { disable: true } },
  render: () => <ButtonOverview />,
};
export const B01: Story = { name: 'Default' };
export const B02: Story = { name: 'Disabled', args: buttonDisabledArgs };
export const Outline: Story = { name: 'Outline button', args: buttonExamples.outline.args };
export const Icon: Story = { args: buttonIconArgs };
export const Secondary: Story = { args: buttonExamples.secondary.args };
export const Ghost: Story = { args: buttonExamples.ghost.args };
export const Destructive: Story = { args: buttonExamples.destructive.args };
export const Link: Story = { args: buttonExamples.link.args };
