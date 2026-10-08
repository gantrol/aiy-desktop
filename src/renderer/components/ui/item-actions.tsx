import type { ComponentProps } from 'react';
import { cn } from '@/renderer/lib/utils';

/** Hidden actions stay keyboard-accessible; focus, open menus and touch reveal them. */
export const contextualActionVisibilityClassName =
  'pointer-events-none opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(any-pointer:coarse)]:pointer-events-auto [@media(any-pointer:coarse)]:opacity-100 motion-reduce:transition-none';

/** Use a group/item on the row or card, outside any nested child items. */
export const itemActionVisibilityClassName =
  contextualActionVisibilityClassName +
  ' group-hover/item:pointer-events-auto group-hover/item:opacity-100 group-focus-within/item:pointer-events-auto group-focus-within/item:opacity-100';

export const itemActionButtonClassName =
  'size-6 shrink-0 rounded-sm text-muted-foreground hover:bg-hover-strong hover:text-foreground data-[state=open]:bg-hover-strong data-[state=open]:text-foreground [@media(any-pointer:coarse)]:size-8';

/** Use inside a group/item. Hidden actions retain their space beside content and status. */
export function ItemActions({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      data-slot="item-actions"
      data-item-drag-ignore
      className={cn('relative z-30 flex shrink-0 items-center gap-0.5', itemActionVisibilityClassName, className)}
    />
  );
}
