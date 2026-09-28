import { useState, type ComponentType, type ReactNode } from 'react';
import { ChevronRight, KeyRound } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CODEX_CONTENT_APPLICATION_ID, type ContentApplication } from '@/shared/contracts/content-applications';
import type { DesktopNote } from '@/shared/contracts/desktop-petals';
import { CodexPetalAction } from '@/renderer/features/extensions/codex-content/CodexPetalAction';
import { CodexAgentLight } from '@/renderer/features/extensions/codex-content/CodexAgentLight';
import { useNoteApplicationPanel } from '@/renderer/features/desktop-petals/use-note-application-panel';
interface ApplicationControlProps {
  note: DesktopNote;
  prepare(): Promise<DesktopNote | null>;
  disabled: boolean;
}
const applicationControls: Readonly<Record<string, ComponentType<ApplicationControlProps>>> = {
  [CODEX_CONTENT_APPLICATION_ID]: CodexPetalAction,
};

export function PetalExternalApplications({
  applications,
  note,
  prepare,
  disabled,
  onError,
  visible,
  toolbar,
  panelHeight,
}: {
  applications: readonly ContentApplication[];
  note: DesktopNote;
  prepare(): Promise<DesktopNote | null>;
  disabled: boolean;
  onError(reason: unknown): void;
  visible: boolean;
  toolbar(trigger: ReactNode): ReactNode;
  panelHeight: number;
}) {
  const copy = useI18n().messages.desktopPetals.externalApplications;
  const [selected, setSelected] = useState<string | null>(null);
  const application = applications.find((item) => item.id === selected) ?? applications[0];
  const panel = useNoteApplicationPanel(panelHeight, visible && !disabled && !!application, onError);
  const open = panel.height > 0;
  if (!application || !visible) return toolbar(null);
  const Control = applicationControls[application.id];
  // Reserve one action row, plus a selector row only when there are multiple applications.
  const expandedHeight = applications.length > 1 ? 96 : 64;
  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => panel.change(next ? expandedHeight : 0)}
      className="shrink-0 text-xs"
      aria-label={copy.title}
    >
      {toolbar(
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            disabled={disabled || panel.busy}
            className="min-w-0 max-w-24 shrink-0 gap-1 rounded-sm px-1 text-inherit"
          >
            <ChevronRight
              className={`size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none${open ? ' rotate-90' : ''}`}
            />
            <span className="truncate">{application.name}</span>
            {application.id === CODEX_CONTENT_APPLICATION_ID && <CodexAgentLight />}
          </Button>
        </CollapsibleTrigger>,
      )}
      <CollapsibleContent
        style={{ height: panel.height }}
        className="mx-3 min-w-0 overflow-y-auto border-t border-current/10 py-2"
      >
        {open && applications.length > 1 && (
          <Select value={application.id} onValueChange={setSelected} disabled={disabled}>
            <SelectTrigger
              className="h-7 w-auto max-w-24 rounded-sm border-0 bg-transparent px-1 text-xs shadow-none"
              aria-label={copy.title}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              collisionPadding={12}
              className="max-h-[min(14rem,var(--radix-select-content-available-height))] max-w-[calc(100vw-24px)]"
            >
              {applications.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {open &&
          (!application.available || !Control ? (
            <Button
              variant="ghost"
              size="xs"
              className="ml-auto flex gap-1.5 rounded-sm text-inherit"
              disabled={disabled}
              onClick={() =>
                void window.desktopPetals.externalApplications
                  .command({
                    applicationId: application.id,
                    command: { kind: 'open-settings' },
                  })
                  .catch(onError)
              }
            >
              <KeyRound className="size-3.5" />
              {copy.permissions}
            </Button>
          ) : (
            <Control key={application.id} note={note} prepare={prepare} disabled={disabled} />
          ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
