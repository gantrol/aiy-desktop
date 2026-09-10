import type { ReactNode } from 'react';
import { ArrowLeftIcon, PanelLeftCloseIcon } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { CreationOutline, type CreationOutlineProps } from '@/renderer/features/creation-outline/CreationOutline';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props extends CreationOutlineProps {
  resizeHandle: ReactNode;
  collapsible: boolean;
  onClose(): void;
  onCollapse(): void;
}

export function CreationOutlineSidebar({ resizeHandle, collapsible, onClose, onCollapse, ...outline }: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.results;
  return (
    <aside className="relative flex size-full min-h-0 min-w-0 flex-col border-r bg-background">
      {resizeHandle}
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2">
        <Button variant="ghost" size="icon-sm" title={labels.library} aria-label={labels.library} onClick={onClose}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">{messages.creator.outline.title}</h1>
        {collapsible && (
          <Button
            variant="ghost"
            size="icon-sm"
            title={labels.collapse}
            aria-label={labels.collapse}
            onClick={onCollapse}
          >
            <PanelLeftCloseIcon className="size-4" />
          </Button>
        )}
      </header>
      <CreationOutline {...outline} />
    </aside>
  );
}
