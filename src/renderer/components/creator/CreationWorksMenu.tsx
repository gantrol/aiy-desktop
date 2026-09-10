import { useRef, useState } from 'react';
import { CheckIcon, Link2Icon } from 'lucide-react';
import { creationFormIcons } from '@/renderer/components/creator/creationFormIcons';
import type { BootstrapDto, CreationFormEntityRef } from '@/shared/contracts';
import { Button } from '@/renderer/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/renderer/components/ui/dropdown-menu';
import { useI18n } from '@/renderer/i18n/useI18n';
import { creationFormByEntity } from '@/renderer/components/creator/creationFormEntities';
import {
  compareCreationForms,
  creationFormTitle,
  projectCreationForm,
  type CreationFormProjection,
} from '@/renderer/components/creator/creationLibraryProjection';
import { useCreationWorkIndex } from '@/renderer/components/creator/useCreationWorkIndex';
import { creationWorkTitleSuffixes } from '@/renderer/components/creator/creationWorkTitles';

function WorkLabel({ form, suffix }: { form: CreationFormProjection; suffix?: string }) {
  const labels = useI18n().messages.creator.album;
  const Icon = creationFormIcons[form.role];
  const title = creationFormTitle(form, labels);
  return (
    <>
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{title}</span>
      {suffix && <span className="shrink-0 font-mono text-xs text-muted-foreground">{suffix}</span>}
      {title !== labels.formKinds[form.role] && (
        <span className="shrink-0 text-xs text-muted-foreground">{labels.formKinds[form.role]}</span>
      )}
    </>
  );
}

export interface CreationRelationsAction {
  count: number;
  onOpen(): void;
}

export function CreationWorksMenu({
  data,
  activeEntity,
  onSelect,
  notify,
  relationsAction,
}: {
  data: BootstrapDto;
  activeEntity: CreationFormEntityRef | null;
  onSelect(form: CreationFormProjection): Promise<unknown> | void;
  notify(message: string): void;
  relationsAction?: CreationRelationsAction;
}) {
  const { messages } = useI18n();
  const labels = messages.creator.workNavigation;
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const context = activeEntity ? creationFormByEntity(data.creationItems, activeEntity.kind, activeEntity.id) : null;
  const index = useCreationWorkIndex(data);
  const forms = (context?.item.forms ?? [])
    .filter((form) => form.entity.kind !== 'DERIVED_VISUAL')
    .sort(compareCreationForms)
    .map((form) => projectCreationForm(form, index))
    .filter((form) => form.entity || form.entityRef.kind === 'VIDEO_DOCUMENT');
  const selectedId = context?.form.entity.kind === 'DERIVED_VISUAL' ? context.form.sourceFormId : context?.form.id;
  const suffixes = creationWorkTitleSuffixes(
    forms.map((form) => ({
      id: form.entityRef.id,
      title: `${form.role}:${creationFormTitle(form, messages.creator.album)}`,
    })),
  );
  const hasOtherWorks = forms.some((form) => form.key !== context?.form.id);
  if (!hasOtherWorks) return <CreationRelationsButton action={relationsAction} />;
  const select = async (form: CreationFormProjection) => {
    if (lock.current || form.key === context?.form.id) return;
    lock.current = true;
    setPending(true);
    try {
      await onSelect(form);
    } catch {
      notify(labels.openFailed);
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="shrink-0"
          data-creation-works
          disabled={pending}
          aria-label={labels.relatedContent}
          title={labels.relatedContent}
        >
          <Link2Icon className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label={labels.relatedContent}
        className="max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
      >
        {forms.map((form) => {
          const title = creationFormTitle(form, messages.creator.album);
          const selected = form.key === selectedId;
          return (
            <DropdownMenuItem
              key={form.key}
              className="min-w-0 gap-1.5"
              disabled={pending || form.key === context?.form.id}
              aria-current={selected ? 'page' : undefined}
              title={`${messages.creator.album.formKinds[form.role]} · ${title}`}
              onSelect={() => void select(form)}
            >
              <WorkLabel form={form} suffix={suffixes.get(form.entityRef.id)} />
              {selected && <CheckIcon className="ml-auto size-3.5 shrink-0" />}
            </DropdownMenuItem>
          );
        })}
        {Boolean(relationsAction?.count) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => relationsAction?.onOpen()}>
              <Link2Icon className="size-3.5" />
              {labels.sourceAndDerived}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{relationsAction?.count}</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CreationRelationsButton({ action }: { action?: CreationRelationsAction }) {
  const labels = useI18n().messages.creator.workNavigation;
  if (!action?.count) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0"
      aria-label={labels.relatedContent}
      title={labels.relatedContent}
      onClick={action.onOpen}
    >
      <Link2Icon className="size-4" aria-hidden="true" />
    </Button>
  );
}
