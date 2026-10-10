import { useState } from 'react';
import { ArrowUpRight, ChevronDown, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { contextualActionVisibilityClassName } from '@/renderer/components/ui/item-actions';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useHoverDropdown } from '@/renderer/components/ui/use-hover-dropdown';
import { useI18n } from '@/renderer/i18n/useI18n';
import { ContentReferencePicker } from '@/renderer/features/content-editor/ContentReferencePicker';
import { ContentReferenceSource } from '@/renderer/features/content-editor/ContentReferenceSource';
import { ContentReferencePresentationMenu } from '@/renderer/features/content-editor/ContentReferencePresentationMenu';
import {
  useReferenceActions,
  type ReferenceActionsProps,
  type ReferenceMode,
} from '@/renderer/features/content-editor/useReferenceActions';

export function ContentReferenceToolbar(props: ReferenceActionsProps & { visible: boolean; editable: boolean }) {
  const { reference, resolution, presentation, node, visible, editable } = props;
  const copy = useI18n().messages.referenceOutline;
  const actions = useReferenceActions(props);
  const [openMenu, setOpenMenu] = useState<'mode' | 'source' | 'more' | null>(null);
  const changeMenu = (menu: NonNullable<typeof openMenu>, open: boolean) =>
    setOpenMenu((current) => (open ? menu : current === menu ? null : current));
  const modeMenu = useHoverDropdown(openMenu === 'mode', (open) => changeMenu('mode', open), actions.busy);
  const sourceMenu = useHoverDropdown(openMenu === 'source', (open) => changeMenu('source', open), actions.busy);
  const selector = reference.selector?.kind === 'BLOCK' ? reference.selector : undefined;
  const names = { LINK: copy.linkMode, FOLLOW: copy.following, SYNC: copy.syncSource, FIXED: copy.fixedReference };
  const show = visible || Boolean(openMenu) || actions.busy || Boolean(actions.error);
  const canOpen = ['ARTICLE', 'INSPIRATION_STASH', 'SOCIAL_POST', 'ALBUM'].includes(reference.source.kind);
  const canChoosePlacement = canOpen && reference.source.kind !== 'ALBUM';
  return (
    <>
      <div
        data-reference-toolbar
        data-visible={show}
        className={`flex shrink-0 items-center gap-0.5 ${contextualActionVisibilityClassName} group-hover/reference:pointer-events-auto group-hover/reference:opacity-100 group-focus-within/reference:pointer-events-auto group-focus-within/reference:opacity-100 data-[visible=true]:pointer-events-auto data-[visible=true]:opacity-100`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {editable ? (
          <DropdownMenu {...modeMenu.rootProps}>
            <DropdownMenuTrigger asChild {...modeMenu.triggerProps}>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-1.5 text-xs"
                disabled={actions.busy}
                aria-label={copy.referenceMode}
                title={actions.mode === 'SYNC' ? copy.followSavedOnly : names[actions.mode]}
              >
                {names[actions.mode]}
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" {...modeMenu.contentProps}>
              <DropdownMenuRadioGroup
                value={actions.mode}
                onValueChange={(value) => void actions.changeMode(value as ReferenceMode)}
              >
                <DropdownMenuRadioItem value="LINK" disabled={!actions.link}>
                  {copy.linkMode}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="FOLLOW" disabled={!actions.canFollow}>
                  {copy.following}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="SYNC" disabled={!actions.canSync}>
                  {copy.syncSource}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="FIXED">{copy.fixedReference}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="px-1.5 text-xs">{names[actions.mode]}</span>
        )}
        {canOpen && (
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={actions.busy}
              title={canChoosePlacement ? copy.openSourceInTab : copy.openSource}
              aria-label={canChoosePlacement ? copy.openSourceInTab : copy.openSource}
              onClick={() => {
                setOpenMenu(null);
                void actions.openSource();
              }}
            >
              <ArrowUpRight className="size-3.5" />
            </Button>
            {canChoosePlacement && (
              <DropdownMenu {...sourceMenu.rootProps}>
                <DropdownMenuTrigger asChild {...sourceMenu.triggerProps}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="w-5"
                    disabled={actions.busy}
                    title={copy.sourceOpenOptions}
                    aria-label={copy.sourceOpenOptions}
                  >
                    <ChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" {...sourceMenu.contentProps}>
                  <DropdownMenuItem onSelect={() => void actions.openSource('beside')}>
                    {copy.openSourceBeside}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void actions.openSource('current')}>
                    {copy.openSourceHere}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
        <Popover open={openMenu === 'more'} onOpenChange={(open) => changeMenu('more', open)}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" title={copy.referenceActions} aria-label={copy.referenceActions}>
              <MoreHorizontal className="size-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1">
            {editable && (
              <ContentReferencePicker
                key={`${reference.id}:${actions.mode}`}
                source={reference.source}
                label={copy.adjustScope}
                menuItem
                lockMode
                configurePresentation={false}
                initialPresentation={
                  presentation?.display === 'LINK' ? { ...presentation, display: 'BODY' } : presentation
                }
                initialMode={resolution.mode === 'FOLLOW' ? 'FOLLOW' : 'FIXED'}
                following={resolution.mode === 'FOLLOW'}
                blockId={selector?.blockId}
                section={selector?.section}
                scope={selector?.scope}
                prepareSource={actions.flushSource}
                onInsert={actions.replace}
              />
            )}
            <ContentReferenceSource
              reference={resolution.captured ?? reference}
              originBlockId={String(node.attrs.blockId ?? '')}
              menuItem
            />
            {editable && actions.mode !== 'LINK' && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start font-normal"
                    disabled={actions.busy}
                  >
                    <SlidersHorizontal className="size-3.5" />
                    {copy.appearance}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <ContentReferencePresentationMenu
                    presentation={presentation}
                    onChange={(value) => void actions.changePresentation(value)}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start font-normal"
              disabled={actions.busy}
              onClick={() => void actions.copy('REFERENCE')}
            >
              {copy.copyReference}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start font-normal"
              disabled={actions.busy}
              onClick={() => void actions.copy('TEXT')}
            >
              {copy.copyText}
            </Button>
            {editable && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start font-normal"
                disabled={actions.busy}
                onClick={() => void actions.convert()}
              >
                {copy.convert}
              </Button>
            )}
          </PopoverContent>
        </Popover>
      </div>
      {actions.error && (
        <span role="alert" className="basis-full text-xs text-destructive">
          {actions.error}
        </span>
      )}
    </>
  );
}
