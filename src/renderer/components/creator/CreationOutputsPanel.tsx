import { useContext, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ArrowLeftIcon, ChevronDownIcon, PlusIcon } from 'lucide-react';
import { CreationWorkNavigationContext } from '@/renderer/components/creator/CreationWorkNavigation';
import type { CreationWorksMenu } from '@/renderer/components/creator/CreationWorksMenu';
import { creationFormIcons } from '@/renderer/components/creator/creationFormIcons';
import { creationFormTitle } from '@/renderer/components/creator/creationLibraryProjection';
import { useCreationWorks } from '@/renderer/components/creator/useCreationWorks';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/renderer/components/ui/collapsible';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  createActions?: ReactNode;
}

export function CreationOutputsPanel(props: Props) {
  const navigation = useContext(CreationWorkNavigationContext);
  return navigation ? (
    <CreationOutputsList
      key={`${navigation.activeEntity?.kind}:${navigation.activeEntity?.id}:${navigation.activeCreationItemId}`}
      {...props}
      navigation={navigation}
    />
  ) : null;
}

function CreationOutputsList({
  navigation,
  createActions,
}: Props & { navigation: ComponentProps<typeof CreationWorksMenu> }) {
  const { messages } = useI18n();
  const copy = messages.creator.outputs;
  const { forms, selectedId, source, suffixes } = useCreationWorks(navigation);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const visible = forms.filter((form) =>
    creationFormTitle(form, messages.creator.album).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  async function run(action: () => Promise<unknown> | void) {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    try {
      await action();
    } catch {
      navigation.notify(messages.creator.workNavigation.openFailed);
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <div className="flex min-h-0 flex-col gap-3" data-creation-outputs>
      {forms.length > 0 && <h2 className="px-2 text-sm font-medium">{copy.title}</h2>}
      {forms.length === 0 && !createActions && !navigation.onCreateAnother && (
        <span role="status" className="px-2 py-3 text-xs text-muted-foreground">
          {copy.empty}
        </span>
      )}
      {source && (
        <Button
          variant="ghost"
          size="sm"
          className="justify-start"
          disabled={pending}
          onClick={() => void run(() => navigation.onSelect(source))}
        >
          <ArrowLeftIcon className="size-3.5" aria-hidden />
          {messages.creator.workNavigation.returnToSource}
        </Button>
      )}
      {(forms.length > 6 || query.length > 0) && (
        <Input
          aria-label={copy.search}
          placeholder={copy.search}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      {forms.length > 0 && (
        <nav className="flex flex-col gap-0.5" aria-label={copy.title} aria-busy={pending}>
          {visible.map((form) => {
            const title = creationFormTitle(form, messages.creator.album);
            const Icon = creationFormIcons[form.role];
            const selected = form.key === selectedId;
            return (
              <Button
                key={form.key}
                variant={selected ? 'secondary' : 'ghost'}
                className="h-auto min-h-10 w-full justify-start gap-2 rounded-sm px-2 py-2 text-left"
                title={title}
                aria-label={`${selected ? copy.editing : copy.open}: ${title}`}
                aria-current={selected ? 'page' : undefined}
                disabled={pending}
                onClick={() => {
                  if (!selected) void run(() => navigation.onSelect(form));
                }}
              >
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{title}</span>
                {suffixes.get(form.entityRef.id) && (
                  <span className="text-xs text-muted-foreground">{suffixes.get(form.entityRef.id)}</span>
                )}
                <span className="shrink-0 text-xs text-muted-foreground">{selected ? copy.editing : copy.open}</span>
              </Button>
            );
          })}
          {visible.length === 0 && (
            <span role="status" className="px-2 py-3 text-xs text-muted-foreground">
              {copy.emptySearch}
            </span>
          )}
        </nav>
      )}
      {createActions ? (
        <Collapsible defaultOpen={forms.length <= 6} className={forms.length > 0 ? 'border-t pt-2' : undefined}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="group h-9 w-full justify-start rounded-sm px-2 text-sm font-medium">
              <PlusIcon className="size-4" aria-hidden />
              {copy.add}
              <ChevronDownIcon className="ml-auto size-3.5 group-data-[state=open]:rotate-180" aria-hidden />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>{createActions}</CollapsibleContent>
        </Collapsible>
      ) : (
        navigation.onCreateAnother && (
          <Button
            variant="ghost"
            className="h-10 justify-start rounded-sm border-t px-2"
            disabled={pending}
            onClick={() => void run(() => navigation.onCreateAnother!())}
          >
            <PlusIcon className="size-4" aria-hidden />
            {copy.prepare}
          </Button>
        )
      )}
    </div>
  );
}
