import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ComponentProps } from 'react';
import { ArticleEditor } from '@/renderer/components/creator/ArticleEditor';
import { ArticleSample, type ArticleSampleProps } from './ArticleSample';

const meta = {
  id: 'creation-editor',
  title: 'Creation/Editor workspace',
  component: ArticleEditor,
  args: { scenario: 'existing' },
  parameters: { controls: { include: ['scenario'] } },
  argTypes: { scenario: { control: 'select', options: ['existing', 'blank', 'saveFailure', 'outline'] } },
  render: (args) => <ArticleSample key={args.scenario} {...args} />,
} satisfies Meta<ComponentProps<typeof ArticleEditor> & ArticleSampleProps>;
export default meta;
type Story = StoryObj<ArticleSampleProps>;
export const Existing: Story = { name: 'Existing draft' };
export const Blank: Story = { name: 'Blank', args: { scenario: 'blank' } };
export const SaveFailure: Story = { name: 'Save failure', args: { scenario: 'saveFailure' } };
export const Outline: Story = { name: 'Outline', args: { scenario: 'outline' } };
export const Narrow: Story = { globals: { viewport: { value: 'aiyNarrow', isRotated: false } } };
