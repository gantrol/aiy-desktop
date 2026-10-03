import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { FoundationOverview } from './FoundationOverview';

const meta = {
  id: 'interface-overview',
  title: 'Interface/Overview',
  subcomponents: { Button, Input },
  parameters: { controls: { disable: true } },
  render: () => <FoundationOverview />,
} satisfies Meta;
export default meta;
export const Overview: StoryObj<typeof meta> = {};
