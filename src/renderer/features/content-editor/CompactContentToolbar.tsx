import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { Separator } from '@/renderer/components/ui/separator';
import { ContentFigureReferencePicker } from '@/renderer/features/content-editor/ContentFigureReferencePicker';
import { ContentToolbar } from '@/renderer/features/content-editor/ContentToolbar';
import { useContentMenuAction } from '@/renderer/features/content-editor/useContentMenuAction';
import { cn } from '@/renderer/lib/utils';
import {
  FormatButton,
  type Props as ToolbarProps,
} from '@/renderer/features/video-documents/VideoDocumentWysiwygToolbar';
import { useI18n } from '@/renderer/i18n/useI18n';
import {
  CheckIcon,
  ChevronDownIcon,
  Code2Icon,
  ImagePlusIcon,
  ItalicIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  MoreHorizontalIcon,
  PlusIcon,
  QuoteIcon,
  SearchIcon,
  StrikethroughIcon,
  Table2Icon,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';

interface Action {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  run(): void;
}

function CommandItems({ actions, onRun }: { actions: readonly Action[]; onRun(action: () => void): void }) {
  return actions.map(({ label, icon: Icon, active, run }) => (
    <DropdownMenuItem
      key={label}
      role={active === undefined ? undefined : 'menuitemcheckbox'}
      aria-checked={active}
      onSelect={() => onRun(run)}
    >
      <Icon className="size-3.5" />
      {label}
      {active && <CheckIcon className="ml-auto size-3.5" />}
    </DropdownMenuItem>
  ));
}

function ActionMenu({
  label,
  icon: Icon,
  groups,
  active,
}: {
  label: string;
  icon: LucideIcon;
  groups: readonly (readonly Action[])[];
  active?: boolean;
}) {
  const menu = useContentMenuAction();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn('size-7', active && 'bg-selected text-selected-foreground hover:bg-selected/80')}
          aria-label={label}
          title={label}
          aria-pressed={active}
        >
          <Icon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={menu.onCloseAutoFocus}>
        {groups
          .filter((group) => group.length)
          .map((group, index) => (
            <div key={group[0].label}>
              {index > 0 && <DropdownMenuSeparator />}
              <CommandItems actions={group} onRun={menu.run} />
            </div>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type Props = Pick<
  ToolbarProps,
  | 'editor'
  | 'state'
  | 'labels'
  | 'referenceAction'
  | 'figureAssetIds'
  | 'mediaBindings'
  | 'searchOpen'
  | 'onSearchToggle'
> & {
  heading: ReactNode;
  bold: ReactNode;
  italic: ReactNode;
  link: ReactNode;
  history: ReactNode;
  uploading: boolean;
  onUpload(): void;
};

function InsertMenu({
  editor,
  state,
  labels,
  referenceAction,
  figureAssetIds = [],
  mediaBindings,
  uploading,
  onUpload,
}: Props) {
  const copy = useI18n().messages.contentEditor.toolbar;
  const [open, setOpen] = useState(false);
  const menu = useContentMenuAction();
  const close = () => menu.run(() => setOpen(false));
  const run = (action: () => void) =>
    menu.run(() => {
      setOpen(false);
      action();
    });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-1.5 text-xs" aria-label={labels.insert}>
          <PlusIcon className="size-3.5" />
          {labels.insert}
          <ChevronDownIcon className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1" onCloseAutoFocus={menu.onCloseAutoFocus}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start font-normal"
          disabled={uploading || state.image}
          onClick={() => run(onUpload)}
        >
          <ImagePlusIcon className="size-3.5" />
          {copy.inlineImage}
        </Button>
        <ContentFigureReferencePicker
          editor={editor}
          assetIds={figureAssetIds}
          availableAssetIds={new Set(mediaBindings.map((binding) => binding.assetId))}
          onInserted={close}
        />
        {referenceAction}
        <Separator className="my-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start font-normal"
          disabled={!editor.can().insertTable({ rows: 3, cols: 3, withHeaderRow: true })}
          onClick={() =>
            run(() => {
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
            })
          }
        >
          <Table2Icon className="size-3.5" />
          {labels.insertTable}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start font-normal"
          onClick={() =>
            run(() => {
              editor.chain().focus().setHorizontalRule().run();
            })
          }
        >
          <MinusIcon className="size-3.5" />
          {labels.horizontalRule}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

export function CompactContentToolbar(props: Props) {
  const { editor, state, labels } = props;
  const copy = useI18n().messages.contentEditor.toolbar;
  const lists: Action[] = [
    {
      label: labels.bulletList,
      icon: ListIcon,
      active: state.bulletList,
      run: () => {
        editor.chain().focus().toggleBulletList().run();
      },
    },
    {
      label: labels.orderedList,
      icon: ListOrderedIcon,
      active: state.orderedList,
      run: () => {
        editor.chain().focus().toggleOrderedList().run();
      },
    },
    {
      label: labels.taskList,
      icon: ListChecksIcon,
      active: state.taskList,
      run: () => {
        editor.chain().focus().toggleTaskList().run();
      },
    },
  ];
  const more: Action[] = [
    {
      label: labels.strike,
      icon: StrikethroughIcon,
      active: state.strike,
      run: () => {
        editor.chain().focus().toggleStrike().run();
      },
    },
    {
      label: labels.blockquote,
      icon: QuoteIcon,
      active: state.blockquote,
      run: () => {
        editor.chain().focus().toggleBlockquote().run();
      },
    },
    {
      label: labels.codeBlock,
      icon: Code2Icon,
      active: state.codeBlock,
      run: () => {
        editor.chain().focus().toggleCodeBlock().run();
      },
    },
  ];
  return (
    <ContentToolbar label={labels.formatting}>
      {(narrow) => (
        <>
          {props.history}
          <Separator orientation="vertical" className="mx-1 h-4" />
          {props.heading}
          {props.bold}
          {!narrow && props.italic}
          {!narrow && (
            <ActionMenu
              label={copy.lists}
              icon={ListIcon}
              active={state.bulletList || state.orderedList || state.taskList}
              groups={[lists]}
            />
          )}
          {props.link}
          <Separator orientation="vertical" className="mx-1 h-4" />
          <InsertMenu {...props} />
          {!narrow && (
            <FormatButton
              label={labels.search}
              active={props.searchOpen}
              expanded={props.searchOpen}
              onClick={props.onSearchToggle}
            >
              <SearchIcon className="size-3.5" />
            </FormatButton>
          )}
          <ActionMenu
            label={labels.more}
            icon={MoreHorizontalIcon}
            groups={[
              narrow
                ? [
                    {
                      label: labels.italic,
                      icon: ItalicIcon,
                      active: state.italic,
                      run: () => {
                        editor.chain().focus().toggleItalic().run();
                      },
                    },
                    ...lists,
                  ]
                : [],
              more,
              narrow
                ? [{ label: labels.search, icon: SearchIcon, active: props.searchOpen, run: props.onSearchToggle }]
                : [],
            ]}
          />
        </>
      )}
    </ContentToolbar>
  );
}
