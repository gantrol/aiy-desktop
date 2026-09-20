import type { Editor } from '@tiptap/core';
import { useState, type ReactNode } from 'react';
import { Copy, ExternalLink, Pencil, Unlink } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { ContentLinkBlockActions } from '@/renderer/features/content-editor/ContentLinkBlockActions';
import { useContentLinkProviders } from '@/renderer/features/content-editor/ContentLinkProviders';
import { contentLinkBlocks } from '@/renderer/features/content-editor/contentLinkPasteExtension';
import { contentLibraryApi } from '@/renderer/features/content-editor/ContentReferencePicker';
import {
  inlineLinkAt,
  inlineLinkFromElement,
  updateInlineLink,
  type InlineLinkTarget,
} from '@/renderer/features/content-editor/contentInlineLink';
import { useI18n } from '@/renderer/i18n/useI18n';
import { linkCardTarget } from '@/shared/contracts/link-card';
import type { ContentSource } from '@/shared/contracts/content-library';
import { parseAiyDeepLink } from '@/shared/contracts/app-deep-link';
import { openAppContentLink } from '@/renderer/components/app/app-content-link';
import { revealContentFigureReference } from '@/renderer/features/content-editor/contentFigureReference';
import { contentFigureReferenceAssetId } from '@/shared/content-figure-reference';
import { figureReferenceMessages } from '@/shared/i18n/figure-reference';

function supportedLink(href: string) {
  return Boolean(contentFigureReferenceAssetId(href) || linkCardTarget(href) || parseAiyDeepLink(href));
}

type Menu = { blockId?: string; link?: InlineLinkTarget; x: number; y: number };

function openFigureReference(editor: Editor, assetId: string, onOpen?: (assetId: string) => void) {
  if (!onOpen) return revealContentFigureReference(editor, assetId);
  onOpen(assetId);
  return true;
}

export function ContentLinkContextMenu({
  editor,
  source,
  onFigureReferenceClick,
  children,
}: {
  editor: Editor;
  source?: ContentSource;
  onFigureReferenceClick?(assetId: string): void;
  children: ReactNode;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState('');
  const [status, setStatus] = useState('');
  const providers = useContentLinkProviders();
  const { locale, messages } = useI18n();
  const copy = messages.desktopPetals.contentEntry;
  const figureCopy = figureReferenceMessages(locale);
  const openLink = async (href: string) => {
    const assetId = contentFigureReferenceAssetId(href);
    if (assetId) {
      setStatus(openFigureReference(editor, assetId, onFigureReferenceClick) ? '' : figureCopy.unavailable);
      return;
    }
    if (parseAiyDeepLink(href)) {
      setStatus(openAppContentLink(href) ? '' : copy.actionFailed);
      return;
    }
    if (!linkCardTarget(href)) {
      setStatus(copy.invalidLink);
      return;
    }
    setStatus('');
    try {
      await contentLibraryApi().linkOpen(href);
    } catch {
      setStatus(copy.actionFailed);
    }
  };
  const blockAtElement = (target: Element): string | undefined => {
    if (!editor.isEditable) return;
    let root = target;
    while (root.parentElement && root.parentElement !== editor.view.dom) root = root.parentElement;
    const offset = Array.from(editor.view.dom.childNodes).indexOf(root);
    if (offset < 0) return;
    const node = editor.state.doc.nodeAt(editor.view.posAtDOM(editor.view.dom, offset));
    const id = node?.attrs.blockId;
    const block = typeof id === 'string' ? contentLinkBlocks(editor.state.doc, [id])[0] : null;
    const provider = block && providers.find((item) => item.matches(block.attributes.url));
    if (
      block &&
      (block.node.type.name === 'linkCard' ||
        (provider ? provider.actions(source).length : /^https?:\/\//iu.test(block.attributes.url)))
    )
      return id;
  };
  const show = (next: Menu, edit = false) => {
    setStatus('');
    setEditing(edit);
    setAddress(next.link?.href ?? '');
    setMenu(next);
  };
  const change = (href: string | null) => {
    if (!menu?.link) return;
    if (href !== null && !supportedLink(href.trim())) {
      setStatus(copy.invalidLink);
      return;
    }
    if (!updateInlineLink(editor, menu.link, href === null ? null : href.trim())) {
      setStatus(copy.staleLink);
      return;
    }
    setStatus('');
    setMenu(null);
  };
  return (
    <DropdownMenu open={Boolean(menu)} onOpenChange={(open) => !open && setMenu(null)} modal={false}>
      <DropdownMenuTrigger
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none fixed h-0 w-0"
        style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
      />
      <div
        className="min-w-0 overflow-hidden"
        onContextMenu={(event) => {
          if (event.defaultPrevented || editor.isDestroyed || editor.view.composing) return;
          const target = event.target instanceof Element ? event.target.closest('a[href], [data-aiy-link-card]') : null;
          if (!target || !editor.view.dom.contains(target)) return;
          const link = inlineLinkFromElement(editor, target) ?? undefined;
          const blockId = blockAtElement(target);
          if (!link && !blockId) return;
          event.preventDefault();
          event.stopPropagation();
          show({ link, blockId, x: event.clientX, y: event.clientY });
        }}
        onClick={(event) => {
          if (event.defaultPrevented || editor.isDestroyed || editor.view.composing) return;
          const link = inlineLinkFromElement(editor, event.target instanceof Element ? event.target : null);
          if (!link || !supportedLink(link.href)) return;
          if (editor.isEditable && !event.ctrlKey && !event.metaKey && !contentFigureReferenceAssetId(link.href))
            return;
          event.preventDefault();
          event.stopPropagation();
          void openLink(link.href);
        }}
        onPointerOver={(event) => {
          if (!editor.isEditable) return;
          const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
          if (anchor && !anchor.hasAttribute('title'))
            anchor.setAttribute(
              'title',
              contentFigureReferenceAssetId(anchor.getAttribute('href') ?? '') ? figureCopy.open : copy.linkHint,
            );
        }}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            event.isDefaultPrevented() ||
            editor.isDestroyed ||
            editor.view.composing ||
            event.nativeEvent.isComposing ||
            event.repeat ||
            !editor.state.selection.empty
          )
            return;
          const open = (event.ctrlKey || event.metaKey) && event.key === 'Enter';
          const edit = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
          const context = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
          if (!open && !edit && !context) return;
          const link = inlineLinkAt(editor, editor.state.selection.from);
          if (!link) return;
          event.preventDefault();
          event.stopPropagation();
          if (open) {
            void openLink(link.href);
            return;
          }
          const point = editor.view.coordsAtPos(link.from);
          show(
            { link, x: point.left, y: point.bottom },
            edit && editor.isEditable && !contentFigureReferenceAssetId(link.href),
          );
        }}
      >
        {children}
        {status && !menu && (
          <p role="status" className="border-t px-3 py-2 text-xs text-destructive">
            {status}
          </p>
        )}
      </div>
      {menu && (
        <DropdownMenuContent
          align="start"
          className="max-w-80 rounded-sm"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!editor.isDestroyed) editor.view.focus();
          }}
        >
          {menu.link && (
            <>
              {editing ? (
                <form
                  className="grid gap-2 p-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    change(address);
                  }}
                >
                  <label className="text-xs">
                    {copy.url}
                    <Input
                      autoFocus
                      aria-label={copy.url}
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      onKeyDown={(event) => event.stopPropagation()}
                    />
                  </label>
                  <div className="flex justify-end gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
                      {copy.cancel}
                    </Button>
                    <Button type="submit" size="sm">
                      {copy.apply}
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <DropdownMenuItem
                    disabled={!supportedLink(menu.link.href)}
                    onSelect={() => void openLink(menu.link!.href)}
                  >
                    <ExternalLink />
                    {contentFigureReferenceAssetId(menu.link.href) ? figureCopy.open : copy.openLink}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      void navigator.clipboard
                        .writeText(menu.link!.href)
                        .then(() => setStatus(copy.copied))
                        .catch(() => setStatus(copy.actionFailed));
                    }}
                  >
                    <Copy />
                    {copy.copyLink}
                  </DropdownMenuItem>
                  {editor.isEditable && (
                    <>
                      <DropdownMenuItem
                        disabled={Boolean(contentFigureReferenceAssetId(menu.link.href))}
                        onSelect={(event) => {
                          event.preventDefault();
                          setEditing(true);
                        }}
                      >
                        <Pencil />
                        {copy.editLink}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => change(null)}>
                        <Unlink />
                        {copy.removeLink}
                      </DropdownMenuItem>
                    </>
                  )}
                </>
              )}
            </>
          )}
          {status && (
            <p role="status" className="px-2 py-1 text-xs text-destructive">
              {status}
            </p>
          )}
          {menu.blockId && !editing && (
            <>
              {menu.link && <DropdownMenuSeparator />}
              <ContentLinkBlockActions editor={editor} blockId={menu.blockId} source={source} standalone />
            </>
          )}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}
