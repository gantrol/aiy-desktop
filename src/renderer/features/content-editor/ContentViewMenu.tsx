import { CheckIcon, ChevronDownIcon, Columns2Icon, LayoutPanelTopIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuIcon,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ArticleDocumentWidth } from '@/renderer/lib/articleTypography';

export function ContentViewMenu({
  width,
  onWidthChange,
  splitOpen,
  onSplitToggle,
}: {
  width: ArticleDocumentWidth;
  onWidthChange(width: ArticleDocumentWidth): void;
  splitOpen?: boolean;
  onSplitToggle?(): void;
}) {
  const { messages } = useI18n();
  const copy = messages.contentEditor;
  const editorCopy = messages.creator.manuscriptEditor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={editorCopy.viewOptions}>
          <LayoutPanelTopIcon className="size-4" />
          {copy.view}
          <ChevronDownIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{copy.documentWidth}</DropdownMenuLabel>
        {(['STANDARD', 'WIDE'] as const).map((option) => (
          <DropdownMenuItem
            key={option}
            role="menuitemradio"
            aria-checked={width === option}
            onSelect={() => onWidthChange(option)}
          >
            {option === 'STANDARD' ? copy.standardWidth : copy.wideWidth}
            {width === option && <CheckIcon className="ml-auto size-4" />}
          </DropdownMenuItem>
        ))}
        {onSplitToggle && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem role="menuitemcheckbox" aria-checked={splitOpen} onSelect={onSplitToggle}>
              <DropdownMenuIcon>
                <Columns2Icon />
              </DropdownMenuIcon>
              {editorCopy.splitEditor}
              {splitOpen && <CheckIcon className="ml-auto size-4" />}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
