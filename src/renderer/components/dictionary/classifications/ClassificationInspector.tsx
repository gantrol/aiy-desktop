import type {
  DictionaryClassificationLocalizationDto,
  DictionaryClassificationNodeDto,
  DictionaryClassificationTermsDto,
} from '@/shared/contracts';
import {
  ArrowRightIcon,
  BanIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDashedIcon,
  MergeIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import {
  I18nTextInput,
  isI18nTextValueValid,
  type I18nTextTranslation,
} from '@/renderer/components/ui/i18n-text-input';
import { Input } from '@/renderer/components/ui/input';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';

interface Props {
  node: DictionaryClassificationNodeDto;
  parent: DictionaryClassificationNodeDto | null;
  children: DictionaryClassificationNodeDto[];
  terms: DictionaryClassificationTermsDto;
  termsLoading: boolean;
  includeDescendants: boolean;
  termQuery: string;
  busy: boolean;
  onTermQueryChange(value: string): void;
  onIncludeDescendantsChange(value: boolean): void;
  onSelect(id: string): void;
  onSave(name: string, nameLocale: string, localizations: DictionaryClassificationLocalizationDto[]): void;
  onCreateChild(): void;
  onMove(): void;
  onMerge(): void;
  onSetState(): void;
  onRestoreSource(): void;
  onOpenTerm(termId: string): void;
  onCreateTerm(): void;
}

function FieldRow({
  label,
  children,
  align = 'center',
}: {
  label: string;
  children: ReactNode;
  align?: 'center' | 'start';
}) {
  return (
    <div
      className={cn(
        'grid min-h-9 grid-cols-[8.5rem_minmax(0,1fr)] gap-4',
        align === 'start' ? 'items-start' : 'items-center',
      )}
    >
      <span className={cn('text-xs text-muted-foreground', align === 'start' && 'pt-2.5')}>{label}</span>
      {children}
    </div>
  );
}

function ClassificationBasicInformation({
  props,
  name,
  setName,
  nameLocale,
  setNameLocale,
  localizations,
  setLocalizations,
}: {
  props: Props;
  name: string;
  setName(value: string): void;
  nameLocale: string;
  setNameLocale(value: string): void;
  localizations: DictionaryClassificationLocalizationDto[];
  setLocalizations(value: DictionaryClassificationLocalizationDto[]): void;
}) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.inspector;
  const translations: I18nTextTranslation[] = localizations.map((item) => ({
    locale: item.locale,
    value: item.name,
  }));
  return (
    <section className="border-b px-4 py-4">
      <h2 className="mb-3 text-sm font-semibold">{copy.basicInformation}</h2>
      <div className="space-y-2.5">
        <FieldRow label={copy.name} align="start">
          <I18nTextInput
            key={props.node.id}
            value={name}
            locale={nameLocale}
            translations={translations}
            valueMaxLength={160}
            placeholder={copy.namePlaceholder}
            labels={{
              language: copy.language,
              value: copy.localizedName,
              addLanguage: copy.addLanguage,
              removeLanguage: copy.removeLanguage,
              expandLanguages: messages.dictionary.classifications.tree.expand,
              collapseLanguages: messages.dictionary.classifications.tree.collapse,
            }}
            onValueChange={setName}
            onLocaleChange={setNameLocale}
            onTranslationsChange={(items) =>
              setLocalizations(items.map((item) => ({ locale: item.locale, name: item.value })))
            }
          />
        </FieldRow>
        <FieldRow label={copy.stableIdentifier}>
          <Input className="bg-surface-sunken font-mono text-xs" value={props.node.stableKey} readOnly />
        </FieldRow>
        {props.node.sourceType === 'CONTENT_PACK' && (
          <FieldRow label={copy.packageSourceValue}>
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                {props.node.sourceSnapshot?.name ?? props.node.name}
              </span>
              {props.node.modifiedLocally && props.node.sourceSnapshot && (
                <Button type="button" variant="outline" size="sm" disabled={props.busy} onClick={props.onRestoreSource}>
                  <RotateCcwIcon className="size-3.5" />
                  {copy.viewAndRestoreSource}
                </Button>
              )}
              {!props.node.modifiedLocally && <span className="text-xs text-success">{copy.matchesSource}</span>}
            </div>
          </FieldRow>
        )}
        <FieldRow label={copy.parentClassification}>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between px-3 font-normal"
            onClick={props.onMove}
          >
            <span className="truncate">{props.parent?.path ?? copy.topLevel}</span>
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          </Button>
        </FieldRow>
        <FieldRow label={copy.availableInPicker}>
          <button
            type="button"
            role="switch"
            aria-checked={props.node.state === 'ACTIVE'}
            aria-label={copy.availableInPicker}
            data-state={props.node.state === 'ACTIVE' ? 'checked' : 'unchecked'}
            className={cn(
              'relative h-5 w-9 shrink-0 overflow-hidden rounded-full transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              props.node.state === 'ACTIVE' ? 'bg-selected-foreground' : 'bg-border-strong',
            )}
            onClick={props.onSetState}
          >
            <span
              className={cn(
                'absolute top-0.5 left-0.5 size-4 rounded-full bg-surface shadow-overlay transition-transform duration-fast',
                props.node.state === 'ACTIVE' ? 'translate-x-4' : 'translate-x-0',
              )}
            />
          </button>
        </FieldRow>
      </div>
    </section>
  );
}

function ClassificationChildren({ props }: { props: Props }) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.inspector;
  return (
    <section className="border-b px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">
          {copy.childClassifications}{' '}
          <span className="ml-1 font-normal text-muted-foreground">{props.children.length}</span>
        </h2>
        <Button
          data-action="classification-new-child"
          type="button"
          variant="ghost"
          size="sm"
          disabled={props.node.state === 'DISABLED' || props.busy}
          onClick={props.onCreateChild}
        >
          <PlusIcon className="size-3.5" />
          {copy.newChild}
        </Button>
      </div>
      {props.children.length > 0 && (
        <div className="overflow-hidden rounded-md border">
          {props.children.map((child, index) => (
            <button
              key={child.id}
              type="button"
              className={cn(
                'flex h-9 w-full items-center gap-3 px-3 text-left text-sm hover:bg-hover',
                index > 0 && 'border-t',
                child.state === 'DISABLED' && 'text-disabled-foreground',
              )}
              onClick={() => props.onSelect(child.id)}
            >
              <span className="min-w-0 flex-1 truncate">{child.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{child.subtreeTermCount}</span>
              <ChevronRightIcon className="size-3.5 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ClassificationTerms({ props }: { props: Props }) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.inspector;
  return (
    <section className="px-4 py-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{copy.termsAndImages}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{copy.imagesManagedInTerms}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Segmented
            type="single"
            value={props.includeDescendants ? 'subtree' : 'direct'}
            onValueChange={(value) => value && props.onIncludeDescendantsChange(value === 'subtree')}
          >
            <SegmentedItem value="direct">
              {copy.currentOnly} {props.node.directTermCount}
            </SegmentedItem>
            <SegmentedItem value="subtree">
              {copy.includeChildren} {props.node.subtreeTermCount}
            </SegmentedItem>
          </Segmented>
          <Button
            data-action="classification-new-term"
            type="button"
            size="sm"
            disabled={props.node.state === 'DISABLED' || props.busy}
            onClick={props.onCreateTerm}
          >
            <PlusIcon className="size-3.5" />
            {copy.newTerm}
          </Button>
        </div>
      </div>
      <div className="relative mb-3">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={props.termQuery}
          className="pl-9"
          placeholder={copy.searchTerms}
          onChange={(event) => props.onTermQueryChange(event.target.value)}
        />
      </div>
      <div className="overflow-hidden rounded-md border">
        <div className="grid h-9 grid-cols-[minmax(8rem,1fr)_minmax(9rem,1.2fr)_7rem_1.5rem] items-center gap-3 border-b bg-surface-sunken px-3 text-xs text-muted-foreground">
          <span>{copy.term}</span>
          <span>{copy.classification}</span>
          <span>{copy.status}</span>
          <span />
        </div>
        {props.termsLoading ? (
          <div className="grid h-24 place-items-center text-xs text-muted-foreground">{copy.loading}</div>
        ) : props.terms.items.length === 0 ? (
          <div className="grid h-24 place-items-center text-xs text-muted-foreground">{copy.noTerms}</div>
        ) : (
          props.terms.items.map((term) => {
            const approved = term.editorialState === 'APPROVED';
            return (
              <button
                key={term.id}
                type="button"
                className="grid min-h-10 w-full grid-cols-[minmax(8rem,1fr)_minmax(9rem,1.2fr)_7rem_1.5rem] items-center gap-3 border-b px-3 text-left text-xs last:border-b-0 hover:bg-hover"
                onClick={() => props.onOpenTerm(term.id)}
              >
                <span className="truncate text-sm font-medium">{term.title}</span>
                <span className="truncate text-muted-foreground" title={term.classificationPaths.join(' · ')}>
                  {term.classificationPaths.join(' · ')}
                </span>
                <span className={cn('flex items-center gap-1.5', approved ? 'text-success' : 'text-muted-foreground')}>
                  {approved ? <CheckCircle2Icon className="size-3.5" /> : <CircleDashedIcon className="size-3.5" />}
                  {approved ? copy.approved : copy.draft}
                </span>
                <ArrowRightIcon className="size-3.5 text-muted-foreground" />
              </button>
            );
          })
        )}
      </div>
      {!props.termsLoading && props.terms.total > props.terms.items.length && (
        <p className="mt-2 text-xs text-muted-foreground">
          {copy.showing(props.terms.items.length, props.terms.total)}
        </p>
      )}
    </section>
  );
}

function ClassificationInspectorFooter({ props }: { props: Props }) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.inspector;
  return (
    <footer className="flex h-14 shrink-0 items-center justify-end gap-2 border-t px-4">
      <Button type="button" variant="outline" size="sm" disabled={props.busy} onClick={props.onMerge}>
        <MergeIcon className="size-3.5" />
        {copy.merge}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={props.node.state === 'ACTIVE' ? 'text-destructive hover:text-destructive' : ''}
        disabled={props.busy}
        onClick={props.onSetState}
      >
        {props.node.state === 'ACTIVE' ? <BanIcon className="size-3.5" /> : <RotateCcwIcon className="size-3.5" />}
        {props.node.state === 'ACTIVE' ? copy.disableThis : copy.restoreThis}
      </Button>
    </footer>
  );
}

export function ClassificationInspector(props: Props) {
  const { messages } = useI18n();
  const copy = messages.dictionary.classifications.inspector;
  const [name, setName] = useState(props.node.name);
  const [nameLocale, setNameLocale] = useState(props.node.nameLocale);
  const [localizations, setLocalizations] = useState<DictionaryClassificationLocalizationDto[]>(
    props.node.localizations,
  );
  const dirty =
    name.trim() !== props.node.name ||
    nameLocale.trim() !== props.node.nameLocale ||
    JSON.stringify(localizations) !== JSON.stringify(props.node.localizations);
  const namesValid = isI18nTextValueValid(
    name,
    nameLocale,
    localizations.map((item) => ({ locale: item.locale, value: item.name })),
  );
  useEffect(() => {
    setName(props.node.name);
    setNameLocale(props.node.nameLocale);
    setLocalizations(props.node.localizations);
  }, [props.node.id, props.node.localizations, props.node.name, props.node.nameLocale]);

  return (
    <section
      className="flex min-h-0 min-w-0 flex-col bg-background"
      data-classification-inspector
      data-classification-id={props.node.id}
    >
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b px-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold" title={props.node.path}>
            {props.node.path}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-xs text-muted-foreground 2xl:inline">
            {copy.source}
            {props.node.sourceType === 'LOCAL' ? copy.localSource : copy.packSource}
          </span>
          <Button
            type="button"
            size="sm"
            disabled={props.busy || !dirty || !namesValid}
            onClick={() => props.onSave(name, nameLocale, localizations)}
          >
            {copy.saveChanges}
          </Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label={copy.moreActions} onClick={props.onMerge}>
            <MoreHorizontalIcon className="size-4" />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ClassificationBasicInformation
          props={props}
          name={name}
          setName={setName}
          nameLocale={nameLocale}
          setNameLocale={setNameLocale}
          localizations={localizations}
          setLocalizations={setLocalizations}
        />
        <ClassificationChildren props={props} />
        <ClassificationTerms props={props} />
      </div>

      <ClassificationInspectorFooter props={props} />
    </section>
  );
}
