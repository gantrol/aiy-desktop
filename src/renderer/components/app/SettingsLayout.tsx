import {
  CpuIcon,
  FileTextIcon,
  FolderIcon,
  KeyboardIcon,
  MonitorIcon,
  ShieldCheckIcon,
  WrenchIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';

export type SettingsArea = 'interface' | 'editor' | 'ai' | 'shortcuts' | 'maintenance' | 'permissions';

interface Props {
  selected: SettingsArea | 'contentManagement';
  panelId: string;
  onSelect(area: SettingsArea): void;
  onContentManagementOpen(): void;
}

export function SettingsLayout({ selected, panelId, onSelect, onContentManagementOpen }: Props) {
  const { messages } = useI18n();
  const labels = messages.app.settings;

  function region(area: SettingsArea, label: string, className: string, children: ReactNode) {
    return (
      <Button
        type="button"
        variant="ghost"
        aria-label={label}
        aria-pressed={selected === area}
        aria-controls={`${panelId}-${area}`}
        onClick={() => onSelect(area)}
        className={cn(
          'h-auto min-w-0 justify-start whitespace-normal rounded-none p-3 text-left font-normal focus-visible:z-10 focus-visible:ring-inset',
          className,
          selected === area &&
            'bg-selected text-selected-foreground hover:bg-selected ring-1 ring-inset ring-selected-foreground',
        )}
      >
        {children}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-5 @[56rem]/settings:p-6" role="group" aria-label={labels.layout.label}>
      <div className="grid min-h-64 grid-cols-[5.5rem_minmax(0,1fr)_4.5rem] grid-rows-[auto_1fr] overflow-hidden rounded-md border bg-background">
        {region(
          'interface',
          labels.layout.interface,
          'col-span-3 gap-2 border-b bg-muted',
          <>
            <MonitorIcon className="size-4" aria-hidden="true" />
            <span className="flex-1 text-xs font-medium">{labels.layout.interface}</span>
            <span aria-hidden="true" className="flex gap-1.5">
              <span className="size-1.5 rounded-full bg-current opacity-40" />
              <span className="size-1.5 rounded-full bg-current opacity-40" />
              <span className="size-1.5 rounded-full bg-current opacity-40" />
            </span>
          </>,
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={onContentManagementOpen}
          aria-label={labels.manageContent}
          aria-pressed={selected === 'contentManagement'}
          aria-controls={`${panelId}-contentManagement`}
          className={cn(
            'h-auto min-w-0 flex-col items-start justify-start gap-4 whitespace-normal rounded-none border-r p-3 text-left text-xs font-normal focus-visible:z-10 focus-visible:ring-inset',
            selected === 'contentManagement' &&
              'bg-selected text-selected-foreground hover:bg-selected ring-1 ring-inset ring-selected-foreground',
          )}
        >
          <FolderIcon className="size-4" aria-hidden="true" />
          <span>{labels.manageContent}</span>
          <span aria-hidden="true" className="grid w-full gap-3 text-muted-foreground/40">
            {[0, 1, 2].map((row) => (
              <span key={row} className="h-1 w-full rounded-sm bg-current" />
            ))}
          </span>
        </Button>
        {region(
          'editor',
          labels.layout.editor,
          'flex-col items-start gap-4 border-r py-5',
          <>
            <FileTextIcon className="size-5" aria-hidden="true" />
            <span className="font-[family-name:var(--font-content)] text-sm">{labels.layout.editor}</span>
            <span aria-hidden="true" className="grid w-full gap-2 text-muted-foreground/40">
              <span className="h-1 w-3/4 rounded-sm bg-current" />
              <span className="h-1 w-full rounded-sm bg-current" />
              <span className="h-1 w-full rounded-sm bg-current" />
              <span className="h-1 w-1/2 rounded-sm bg-current" />
            </span>
          </>,
        )}
        {region(
          'ai',
          labels.layout.ai,
          'flex-col items-center justify-start gap-4 px-2 py-5 text-xs',
          <>
            <CpuIcon className="size-5" aria-hidden="true" />
            <span>{labels.layout.ai}</span>
          </>,
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {region(
          'shortcuts',
          labels.shortcutsTab,
          'gap-2 rounded-md px-2 py-2 text-xs',
          <>
            <KeyboardIcon className="size-4" aria-hidden="true" />
            {labels.shortcutsTab}
          </>,
        )}
        {region(
          'maintenance',
          labels.maintenanceTab,
          'gap-2 rounded-md px-2 py-2 text-xs',
          <>
            <WrenchIcon className="size-4" aria-hidden="true" />
            {labels.maintenanceTab}
          </>,
        )}
        {region(
          'permissions',
          messages.agentPermissions.tab,
          'gap-2 rounded-md px-2 py-2 text-xs',
          <>
            <ShieldCheckIcon className="size-4" aria-hidden="true" />
            {messages.agentPermissions.tab}
          </>,
        )}
      </div>
    </div>
  );
}
