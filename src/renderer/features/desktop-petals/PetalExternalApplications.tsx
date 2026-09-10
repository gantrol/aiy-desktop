import { useState, type ComponentType } from 'react';
import { ChevronRight, KeyRound } from 'lucide-react';
import { Button } from '@/renderer/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useI18n } from '@/renderer/i18n/useI18n';
import { CODEX_CONTENT_APPLICATION_ID, type ContentApplication } from '@/shared/contracts/content-applications';
import type { DesktopNote } from '@/shared/contracts/desktop-petals';
import { CodexPetalAction } from '@/renderer/features/extensions/codex-content/CodexPetalAction';
import { CodexAgentLight } from '@/renderer/features/extensions/codex-content/CodexAgentLight';
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
}: {
  applications: readonly ContentApplication[];
  note: DesktopNote;
  prepare(): Promise<DesktopNote | null>;
  disabled: boolean;
  onError(reason: unknown): void;
}) {
  const copy = useI18n().messages.desktopPetals.externalApplications;
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const application = applications.find((item) => item.id === selected) ?? applications[0];
  if (!application) return null;
  const Control = applicationControls[application.id];
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="mx-3 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-current/10 py-2 text-xs"
      aria-label={copy.title}
    >
      <div className="flex min-w-0 items-center gap-1">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="xs" className="min-w-0 gap-1.5 rounded-sm px-1.5 text-inherit">
            <ChevronRight
              className={`size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none${open ? ' rotate-90' : ''}`}
            />
            <span className="truncate">{application.name}</span>
            {application.id === CODEX_CONTENT_APPLICATION_ID && <CodexAgentLight />}
          </Button>
        </CollapsibleTrigger>
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
      </div>
      <CollapsibleContent className="min-w-0 flex-[1_1_12rem]">
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
