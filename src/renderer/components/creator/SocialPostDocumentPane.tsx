import { Input } from '@/renderer/components/ui/input';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { useI18n } from '@/renderer/i18n/useI18n';
import { useState, type ReactNode } from 'react';

/** The toolbar stays outside the document's scroll area, while sharing its editor. */
export function SocialPostDocumentPane({
  title,
  onTitleChange,
  children,
}: {
  title: string;
  onTitleChange(title: string): void;
  children(toolbarRoot: HTMLDivElement | null): ReactNode;
}) {
  const copy = useI18n().messages.desktopPetals.document;
  const [toolbarRoot, setToolbarRoot] = useState<HTMLDivElement | null>(null);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div ref={setToolbarRoot} className="shrink-0" />
      <ScrollArea type="always" className="min-h-0 min-w-0 flex-1">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-6 lg:px-8">
          <label className="grid gap-2">
            <span className="text-xs font-medium text-foreground-secondary">{copy.title}</span>
            <Input
              aria-label={copy.title}
              placeholder={copy.title}
              value={title}
              maxLength={200}
              onChange={(event) => onTitleChange(event.target.value)}
            />
          </label>
          {children(toolbarRoot)}
        </div>
      </ScrollArea>
    </div>
  );
}
