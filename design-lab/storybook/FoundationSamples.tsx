import type { ComponentProps } from 'react';
import { XIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { useI18n } from '@/renderer/i18n/useI18n';

const buttonDefaults = { disabled: false, variant: 'default', size: 'default' } as const;

/** Shared by the comparison pages and individually addressable stories. */
export const buttonExamples = {
  primary: { storyId: 'ui-button--b-01', args: buttonDefaults },
  secondary: { storyId: 'ui-button--secondary', args: { ...buttonDefaults, variant: 'secondary' } },
  outline: { storyId: 'ui-button--outline', args: { ...buttonDefaults, variant: 'outline' } },
  ghost: { storyId: 'ui-button--ghost', args: { ...buttonDefaults, variant: 'ghost' } },
  destructive: { storyId: 'ui-button--destructive', args: { ...buttonDefaults, variant: 'destructive' } },
  link: { storyId: 'ui-button--link', args: { ...buttonDefaults, variant: 'link' } },
} as const satisfies Record<string, { storyId: string; args: ComponentProps<typeof Button> }>;

export const buttonDisabledArgs = { ...buttonDefaults, disabled: true } as const;
export const buttonIconArgs = { ...buttonDefaults, variant: 'ghost', size: 'icon-sm' } as const;
export const buttonSizes = ['2xs', 'xs', 'sm', 'default', 'lg', 'icon', 'icon-sm'] as const;

export function ButtonExample(args: ComponentProps<typeof Button>) {
  const { messages } = useI18n();
  const iconOnly = args.size === 'icon' || args.size === 'icon-sm';
  return (
    <Button
      {...args}
      aria-label={args['aria-label'] ?? (iconOnly ? messages.referenceOutline.lookup.clear : undefined)}
    >
      {iconOnly ? <XIcon className="size-4" /> : messages.designLab.components.activate}
    </Button>
  );
}

export type InputSampleArgs = ComponentProps<typeof Input> & { filled?: boolean };
const inputDefaults = { disabled: false, readOnly: false, filled: false } as const;
export const inputExamples = {
  empty: { storyId: 'ui-input--empty', name: 'Empty input', args: inputDefaults },
  filled: { storyId: 'ui-input--filled', name: 'Filled', args: { ...inputDefaults, filled: true } },
  readOnly: {
    storyId: 'ui-input--read-only',
    name: 'Read only',
    args: { ...inputDefaults, filled: true, readOnly: true },
  },
  disabled: {
    storyId: 'ui-input--disabled',
    name: 'Disabled',
    args: { ...inputDefaults, filled: true, disabled: true },
  },
} as const satisfies Record<string, { storyId: string; name: string; args: InputSampleArgs }>;

export function InputExample({ filled, defaultValue, ...args }: InputSampleArgs) {
  const { components, storybook } = useI18n().messages.designLab;
  const initialValue = defaultValue ?? (filled ? storybook.foundation.inputValue : '');
  return (
    <Input
      key={String(initialValue)}
      {...args}
      defaultValue={initialValue}
      aria-label={args['aria-label'] ?? components.input}
      placeholder={components.input}
    />
  );
}
