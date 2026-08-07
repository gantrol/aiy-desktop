import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/renderer/lib/utils';

const buttonVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium outline-none transition-colors duration-fast focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:text-disabled-foreground disabled:opacity-100 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          '[--primary:var(--button-primary)] [--primary-foreground:var(--button-primary-foreground)] [--primary-hover:var(--button-primary-hover)] bg-primary font-semibold text-primary-foreground hover:bg-primary-hover active:bg-primary-hover disabled:bg-hover disabled:text-disabled-foreground',
        destructive:
          'bg-destructive font-semibold text-destructive-foreground hover:bg-destructive-hover active:bg-destructive-hover disabled:bg-destructive-surface disabled:text-disabled-foreground',
        outline:
          'border border-input bg-background text-foreground hover:bg-hover active:bg-pressed disabled:border-border disabled:bg-background',
        secondary:
          'bg-surface-sunken text-foreground-secondary hover:bg-hover-strong active:bg-pressed disabled:bg-hover',
        ghost: 'text-foreground hover:bg-hover active:bg-pressed disabled:bg-transparent',
        link: 'text-primary underline-offset-4 hover:underline active:text-selected-foreground disabled:text-disabled-foreground',
      },
      size: {
        '2xs': "h-6 rounded-md px-2 text-2xs before:absolute before:inset-x-0 before:-inset-y-0.5 before:content-['']",
        xs: 'h-7 rounded-md px-2.5 text-xs',
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6',
        icon: 'size-9',
        'icon-sm': 'size-8',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
