import {
  ArchiveIcon,
  ArrowLeftIcon,
  CircleCheckIcon,
  FilePenLineIcon,
  LoaderCircleIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useEffect, useRef, type ReactElement } from 'react';
import {
  DEFAULT_TERM_CONTEXT_KEY,
  type AssetDto,
  type Locale,
  type TermCategoryDto,
  type TermDraftInput,
  type TermEditorDto,
} from '@/shared/contracts';
import type { DictionaryMessages } from '@/renderer/i18n/catalog';
import { Button } from '@/renderer/components/ui/button';
import { Checkbox } from '@/renderer/components/ui/checkbox';
import { Field, FieldControl, FieldLabel } from '@/renderer/components/ui/field';
import { Input } from '@/renderer/components/ui/input';
import { MetaText } from '@/renderer/components/ui/meta-text';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { StateTag } from '@/renderer/components/ui/state-tag';
import { Textarea } from '@/renderer/components/ui/textarea';
import { TermMediaEditor } from '@/renderer/components/dictionary/TermMediaEditor';
import { TermStateActions } from '@/renderer/components/dictionary/TermStateActions';

interface Props {
  copy: DictionaryMessages;
  locale: Locale;
  categories: TermCategoryDto[];
  detail: TermEditorDto | null;
  draft: TermDraftInput | null;
  dirty: boolean;
  busy: boolean;
  mediaBusy: boolean;
  mediaFocusKey: number;
  availableAssets: AssetDto[];
  onSet<K extends keyof TermDraftInput>(key: K, value: TermDraftInput[K]): void;
  onBack?(): void;
  onSave(): void;
  onApprove(): void;
  onWithdraw(): void;
  onArchive(): void;
  onRestore(): void;
  onAddMedia(assetIds: string[]): Promise<void>;
  onImportMedia(): Promise<void>;
  onSetMediaCover(mediaId: string): Promise<void>;
  onRemoveMedia(mediaId: string): Promise<void>;
  onReorderMedia(mediaIds: string[]): Promise<void>;
}

function EditorField({ id, label, children }: { id: string; label: string; children: ReactElement }) {
  return (
    <Field id={id} className="gap-2">
      <FieldLabel className="text-xs font-medium text-foreground/80">{label}</FieldLabel>
      <FieldControl>{children}</FieldControl>
    </Field>
  );
}

function splitAliases(value: string) {
  return value
    .split(/[,，、]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function localeName(contentLocale: string, uiLocale: Locale) {
  try {
    return new Intl.DisplayNames([uiLocale === 'zh' ? 'zh-CN' : 'en-US'], { type: 'language' }).of(contentLocale);
  } catch {
    return undefined;
  }
}

export function TermEditor({
  copy: c,
  locale,
  categories,
  detail,
  draft,
  dirty,
  busy,
  mediaBusy,
  mediaFocusKey,
  availableAssets,
  onSet,
  onBack,
  onSave,
  onApprove,
  onWithdraw,
  onArchive,
  onRestore,
  onAddMedia,
  onImportMedia,
  onSetMediaCover,
  onRemoveMedia,
  onReorderMedia,
}: Props) {
  const mediaSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mediaFocusKey) return;
    const frame = window.requestAnimationFrame(() =>
      mediaSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [mediaFocusKey, detail?.id]);

  if (!detail || !draft) {
    return (
      <section className="grid min-h-0 place-items-center bg-background text-muted-foreground">{c.noTerms}</section>
    );
  }

  const archived = detail.editorialState === 'ARCHIVED';
  const isDraft = !archived && (detail.hasDraft || dirty || detail.editorialState === 'DRAFT');
  const readyToApprove = Boolean(
    draft.title.trim() &&
    draft.titleLocale.trim() &&
    draft.definition.trim() &&
    draft.classificationIds.length > 0 &&
    draft.primaryDirectoryClassificationId &&
    draft.classificationIds.includes(draft.primaryDirectoryClassificationId) &&
    draft.expressions.some((expression) => expression.positive.trim()),
  );
  const promptClass = 'min-h-28 resize-y font-mono text-xs leading-relaxed';
  const setLocalization = (index: number, patch: Partial<TermDraftInput['localizations'][number]>) => {
    onSet(
      'localizations',
      draft.localizations.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  };
  const setExpression = (index: number, patch: Partial<TermDraftInput['expressions'][number]>) => {
    onSet(
      'expressions',
      draft.expressions.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    );
  };
  const toggleClassification = (classificationId: string, selected: boolean) => {
    const classificationIds = selected
      ? [...new Set([...draft.classificationIds, classificationId])]
      : draft.classificationIds.filter((id) => id !== classificationId);
    onSet('classificationIds', classificationIds);
    if (selected && !draft.primaryDirectoryClassificationId) {
      onSet('primaryDirectoryClassificationId', classificationId);
    } else if (!selected && draft.primaryDirectoryClassificationId === classificationId) {
      onSet('primaryDirectoryClassificationId', classificationIds[0] ?? null);
    }
  };

  return (
    <section
      data-term-editor
      data-term-id={detail.id}
      data-editorial-state={detail.editorialState}
      data-operation-state={busy ? 'pending' : 'idle'}
      aria-busy={busy}
      className="flex size-full min-h-0 flex-col overflow-hidden bg-background"
    >
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b bg-background/95 px-5 py-2.5 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-3">
          {onBack && (
            <Button type="button" variant="ghost" size="icon-sm" aria-label={c.backToDetails} onClick={onBack}>
              <ArrowLeftIcon className="size-4" />
            </Button>
          )}
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight">{draft.title}</h2>
            <div className="mt-0.5 flex items-center gap-2">
              <StateTag
                tone={archived ? 'locked' : isDraft ? 'neutral' : 'success'}
                icon={archived ? <ArchiveIcon /> : isDraft ? <FilePenLineIcon /> : <CircleCheckIcon />}
              >
                {archived ? c.archived : isDraft ? c.draft : c.approved} · V{detail.revisionNo}
              </StateTag>
              {dirty && <MetaText className="text-lifecycle-draft">{c.unsavedChanges}</MetaText>}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {busy && <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />}
          {!archived && (
            <Button data-action="term-save" variant="outline" disabled={busy || !dirty} onClick={onSave}>
              {c.save}
            </Button>
          )}
          {!archived && (
            <Button data-action="term-approve" disabled={busy || !readyToApprove} onClick={onApprove}>
              {c.approve}
            </Button>
          )}
          <TermStateActions
            copy={c}
            detail={detail}
            busy={busy}
            dirty={dirty}
            onWithdraw={onWithdraw}
            onArchive={onArchive}
            onRestore={onRestore}
          />
        </div>
      </header>

      <ScrollArea data-term-editor-scroll type="always" className="min-h-0 flex-1">
        <fieldset disabled={archived} className="min-w-0">
          <div className="mx-auto grid max-w-6xl gap-6 px-5 py-6 xl:grid-cols-[320px_minmax(0,1fr)] xl:px-7">
            <aside ref={mediaSectionRef} className="min-w-0 xl:sticky xl:top-6 xl:self-start">
              <section className="rounded-xl border bg-muted/20 p-4">
                <h3 className="mb-4 text-sm font-semibold">{c.representativeMedia}</h3>
                <TermMediaEditor
                  copy={c}
                  items={detail.media}
                  availableAssets={availableAssets}
                  busy={mediaBusy}
                  disabled={archived}
                  onImport={onImportMedia}
                  onAdd={onAddMedia}
                  onSetCover={onSetMediaCover}
                  onRemove={onRemoveMedia}
                  onReorder={onReorderMedia}
                />
              </section>
            </aside>

            <main className="min-w-0 space-y-4">
              <section data-editor-section="core" className="rounded-xl border bg-background p-5">
                <h3 className="mb-5 text-sm font-semibold">{c.termSection}</h3>
                <div className="grid gap-4">
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
                    <EditorField id="term-title" label={c.titleField}>
                      <Input value={draft.title} onChange={(event) => onSet('title', event.target.value)} />
                    </EditorField>
                    <EditorField id="term-title-locale" label={c.titleLanguage}>
                      <Input
                        value={draft.titleLocale}
                        placeholder={locale}
                        list="dictionary-locale-options"
                        onChange={(event) => onSet('titleLocale', event.target.value)}
                      />
                    </EditorField>
                  </div>
                  <datalist id="dictionary-locale-options">
                    {['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es', 'pt', 'ru', 'ar'].map((item) => (
                      <option key={item} value={item}>
                        {localeName(item, locale)}
                      </option>
                    ))}
                  </datalist>
                  <EditorField id="term-definition" label={c.definition}>
                    <Textarea
                      className="min-h-28 resize-y"
                      value={draft.definition}
                      onChange={(event) => onSet('definition', event.target.value)}
                    />
                  </EditorField>
                  <div className="grid gap-2">
                    <span className="text-xs font-medium text-foreground/80">{c.classifications}</span>
                    <div className="max-h-52 space-y-1 overflow-y-auto rounded-md border p-2">
                      {categories.map((category) => {
                        const checked = draft.classificationIds.includes(category.id);
                        return (
                          <label
                            key={category.id}
                            className="flex min-h-8 items-center gap-2 rounded px-2 text-sm hover:bg-hover"
                          >
                            <Checkbox
                              checked={checked}
                              disabled={category.selectable === false && !checked}
                              onCheckedChange={(value) => toggleClassification(category.id, value === true)}
                            />
                            <span className="min-w-0 flex-1 truncate">{category.name}</span>
                            {category.state === 'DISABLED' && (
                              <span className="text-xs text-muted-foreground">{c.disabled}</span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                  <EditorField id="term-primary-directory" label={c.primaryDirectory}>
                    <Select
                      value={draft.primaryDirectoryClassificationId ?? undefined}
                      onValueChange={(value) => onSet('primaryDirectoryClassificationId', value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={c.choosePrimaryDirectory} />
                      </SelectTrigger>
                      <SelectContent>
                        {categories
                          .filter((category) => draft.classificationIds.includes(category.id))
                          .map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              {category.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </EditorField>
                  <EditorField id="term-aliases" label={c.aliasesOptional}>
                    <Input
                      value={draft.aliases.join(', ')}
                      placeholder={c.aliasesHint}
                      onChange={(event) => onSet('aliases', splitAliases(event.target.value))}
                    />
                  </EditorField>
                </div>
              </section>

              <section data-editor-section="expressions" className="rounded-xl border bg-background p-5">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold">{c.modelExpressions}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{c.modelExpressionsDescription}</p>
                  </div>
                  <Button
                    data-action="term-add-expression"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onSet('expressions', [
                        ...draft.expressions,
                        {
                          contextKey: DEFAULT_TERM_CONTEXT_KEY,
                          modelKey: 'gpt-image-2',
                          locale: draft.titleLocale || locale,
                          positive: '',
                          negative: '',
                        },
                      ])
                    }
                  >
                    <PlusIcon className="size-4" />
                    {c.addExpression}
                  </Button>
                </div>
                <div className="grid gap-4">
                  {draft.expressions.map((expression, index) => (
                    <div
                      key={`${expression.contextKey}-${expression.modelKey}-${expression.locale}-${index}`}
                      className="rounded-lg border p-4"
                    >
                      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_auto]">
                        <EditorField id={`term-expression-context-${index}`} label={c.context}>
                          <Input
                            value={expression.contextKey}
                            placeholder={DEFAULT_TERM_CONTEXT_KEY}
                            onChange={(event) => setExpression(index, { contextKey: event.target.value })}
                          />
                        </EditorField>
                        <EditorField id={`term-expression-model-${index}`} label={c.model}>
                          <Input
                            value={expression.modelKey}
                            onChange={(event) => setExpression(index, { modelKey: event.target.value })}
                          />
                        </EditorField>
                        <EditorField id={`term-expression-locale-${index}`} label={c.language}>
                          <Input
                            value={expression.locale}
                            list="dictionary-locale-options"
                            onChange={(event) => setExpression(index, { locale: event.target.value })}
                          />
                        </EditorField>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="self-end"
                          aria-label={c.removeExpression}
                          onClick={() =>
                            onSet(
                              'expressions',
                              draft.expressions.filter((_, itemIndex) => itemIndex !== index),
                            )
                          }
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      </div>
                      <div className="grid gap-4">
                        <EditorField id={`term-expression-positive-${index}`} label={c.positiveExpression}>
                          <Textarea
                            className={promptClass}
                            value={expression.positive}
                            onChange={(event) => setExpression(index, { positive: event.target.value })}
                          />
                        </EditorField>
                        <EditorField id={`term-expression-negative-${index}`} label={c.negativeExpressionOptional}>
                          <Textarea
                            className={promptClass}
                            value={expression.negative}
                            onChange={(event) => setExpression(index, { negative: event.target.value })}
                          />
                        </EditorField>
                      </div>
                    </div>
                  ))}
                  {!draft.expressions.length && (
                    <p className="text-xs text-muted-foreground">{c.positiveExpressionRequired}</p>
                  )}
                </div>
              </section>

              <section data-editor-section="localizations" className="rounded-xl border bg-background p-5">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold">{c.otherLanguages}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{c.localizationsDescription}</p>
                  </div>
                  <Button
                    data-action="term-add-localization"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onSet('localizations', [
                        ...draft.localizations,
                        { locale: draft.titleLocale === 'en' ? 'zh' : 'en', title: '', definition: '', aliases: [] },
                      ])
                    }
                  >
                    <PlusIcon className="size-4" />
                    {c.addLanguage}
                  </Button>
                </div>
                <div className="grid gap-4">
                  {draft.localizations.map((localization, index) => (
                    <div
                      key={`${localization.locale}-${index}`}
                      data-localization-index={index}
                      data-localization-locale={localization.locale}
                      className="rounded-lg border p-4"
                    >
                      <div className="mb-4 flex items-end gap-3">
                        <div className="min-w-0 flex-1">
                          <EditorField id={`term-localization-locale-${index}`} label={c.language}>
                            <Input
                              value={localization.locale}
                              list="dictionary-locale-options"
                              onChange={(event) => setLocalization(index, { locale: event.target.value })}
                            />
                          </EditorField>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={c.removeLanguage}
                          onClick={() =>
                            onSet(
                              'localizations',
                              draft.localizations.filter((_, itemIndex) => itemIndex !== index),
                            )
                          }
                        >
                          <Trash2Icon className="size-4" />
                        </Button>
                      </div>
                      <div className="grid gap-4">
                        <EditorField id={`term-localization-title-${index}`} label={c.titleField}>
                          <Input
                            value={localization.title}
                            onChange={(event) => setLocalization(index, { title: event.target.value })}
                          />
                        </EditorField>
                        <EditorField id={`term-localization-definition-${index}`} label={c.definitionOptional}>
                          <Textarea
                            value={localization.definition}
                            onChange={(event) => setLocalization(index, { definition: event.target.value })}
                          />
                        </EditorField>
                        <EditorField id={`term-localization-aliases-${index}`} label={c.aliasesOptional}>
                          <Input
                            value={localization.aliases.join(', ')}
                            onChange={(event) => setLocalization(index, { aliases: splitAliases(event.target.value) })}
                          />
                        </EditorField>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </main>
          </div>
        </fieldset>
      </ScrollArea>
    </section>
  );
}
