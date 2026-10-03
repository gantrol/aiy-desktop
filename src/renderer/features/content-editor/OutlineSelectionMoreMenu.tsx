import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  ClipboardPaste,
  IndentDecrease,
  IndentIncrease,
  MoreHorizontal,
  Scissors,
  Trash2,
} from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { useRef } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';

const groups = [
  [
    { action: 'cut', Icon: Scissors },
    { action: 'paste', Icon: ClipboardPaste },
  ],
  [
    { action: 'up', Icon: ArrowUp },
    { action: 'down', Icon: ArrowDown },
    { action: 'indent', Icon: IndentIncrease },
    { action: 'outdent', Icon: IndentDecrease },
  ],
  [
    { action: 'collapse', Icon: ChevronRight },
    { action: 'expand', Icon: ChevronDown },
  ],
  [{ action: 'delete', Icon: Trash2 }],
] as const;
export type OutlineMoreAction = (typeof groups)[number][number]['action'];

export function OutlineSelectionMoreMenu({
  disabled,
  available,
  onAction,
}: {
  disabled: boolean;
  available: Record<OutlineMoreAction, boolean>;
  onAction(action: OutlineMoreAction): void;
}) {
  const copy = useI18n().messages.referenceOutline.selectionToolbar;
  const requested = useRef<OutlineMoreAction | null>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="xs" disabled={disabled} aria-label={copy.more}>
          <MoreHorizontal aria-hidden className="size-3.5" />
          {copy.more}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side="top"
        onCloseAutoFocus={(event) => {
          const action = requested.current;
          requested.current = null;
          if (!action) return;
          event.preventDefault();
          onAction(action);
        }}
      >
        {groups.flatMap((group, index) => [
          ...(index ? [<DropdownMenuSeparator key={`separator-${index}`} />] : []),
          ...group.map(({ action, Icon }) => (
            <DropdownMenuItem
              key={action}
              disabled={disabled || !available[action]}
              variant={action === 'delete' ? 'destructive' : 'default'}
              onSelect={() => {
                requested.current = action;
              }}
            >
              <Icon />
              {copy[action]}
            </DropdownMenuItem>
          )),
        ])}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
