import type { ReactNode } from 'react';
import { ArrowUpRightIcon } from 'lucide-react';
import { addons } from 'storybook/preview-api';
import { SELECT_STORY } from 'storybook/internal/core-events';
import { Button } from '@/renderer/components/ui/button';

/** Use Storybook navigation without reloading the manager or nesting a new iframe. */
export function StoryLink({ storyId, children }: { storyId: string; children: ReactNode }) {
  return (
    <Button
      asChild
      variant="link"
      size="sm"
      className="h-auto gap-1 px-0 py-1 text-inherit [font-size:inherit] [font-weight:inherit]"
    >
      <a
        href={`./?path=/story/${storyId}`}
        target="_top"
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (window.parent === window) return;
          event.preventDefault();
          addons.getChannel().emit(SELECT_STORY, { storyId });
        }}
      >
        {children}
        <ArrowUpRightIcon aria-hidden="true" className="size-3" />
      </a>
    </Button>
  );
}
