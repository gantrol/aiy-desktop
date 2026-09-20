import { Button } from '@/renderer/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/renderer/components/ui/popover';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { insertContentFigureReference } from '@/renderer/features/content-editor/contentFigureReference';
import { useContentMenuAction } from '@/renderer/features/content-editor/useContentMenuAction';
import { useI18n } from '@/renderer/i18n/useI18n';
import { contentImageNumber } from '@/shared/content-image-number';
import type { Editor } from '@tiptap/core';
import { Link2Icon } from 'lucide-react';
import { useState } from 'react';

export function ContentFigureReferencePicker({
  editor,
  assetIds,
  availableAssetIds,
  onInserted,
}: {
  editor: Editor;
  assetIds: readonly string[];
  availableAssetIds: ReadonlySet<string>;
  onInserted(): void;
}) {
  const { locale, messages } = useI18n();
  const copy = messages.contentEditor.toolbar;
  const documentCopy = messages.desktopPetals.document;
  const [open, setOpen] = useState(false);
  const menu = useContentMenuAction();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start font-normal"
          disabled={!assetIds.some((id) => availableAssetIds.has(id))}
        >
          <Link2Icon className="size-3.5" />
          {copy.figureReference}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-40 p-1" onCloseAutoFocus={menu.onCloseAutoFocus}>
        <ScrollArea className="max-h-60 [&_[data-slot=scroll-area-viewport]]:max-h-60">
          {assetIds.map((assetId, index) => {
            const label = documentCopy.imageNumber.replace(
              '{number}',
              contentImageNumber(index + 1, documentCopy.numbering),
            );
            return (
              <Button
                key={assetId}
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start font-normal"
                disabled={!availableAssetIds.has(assetId)}
                onClick={() => {
                  if (!insertContentFigureReference(editor, assetId, label, locale)) return;
                  menu.run(() => {
                    setOpen(false);
                    onInserted();
                  });
                }}
              >
                {label}
              </Button>
            );
          })}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
