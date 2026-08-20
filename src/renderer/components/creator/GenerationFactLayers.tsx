import { useEffect, useMemo, useRef, useState } from 'react';
import { BracesIcon, ImageIcon } from 'lucide-react';
import type {
  GenerationRunDto,
  Locale,
  PromptCommonRecipeReferenceDto,
  PromptPackSourceReferenceDto,
  PromptVersionDto,
  TermListItem,
  WordPaletteDto,
} from '@/shared/contracts';
import { resolveTermTitle } from '@/shared/term-localization';
import {
  resolveLocalizedName,
  resolveWordPaletteOptionLabel,
  resolveWordPaletteParameterName,
} from '@/shared/word-palette-localization';
import { DictionaryIcon } from '@/renderer/icons';
import { Badge } from '@/renderer/components/ui/badge';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/renderer/components/ui/hover-card';

interface Labels {
  userInstruction: string;
  creationInput: string;
  actualRequest: string;
  flatPrompt: string;
  fullRequest: string;
  revision: string;
  parameters: string;
  terms: string;
  references: string;
  sources: string;
  providerReturnedDescription: string;
}

interface Props {
  version: PromptVersionDto;
  run: GenerationRunDto;
  locale: Locale;
  terms: TermListItem[];
  wordPalettes: WordPaletteDto[];
  labels: Labels;
}

function localizedTermName(term: TermListItem | undefined, fallback: string, locale: Locale) {
  if (!term) return fallback;
  return resolveTermTitle(term, locale);
}

function recipeRecord(recipe: PromptCommonRecipeReferenceDto, wordPalettes: WordPaletteDto[], locale: Locale) {
  const palette = wordPalettes.find((item) => item.id === recipe.paletteId);
  const revision = palette?.revisions.find((item) => item.id === recipe.paletteRevisionId);
  const frozenName = resolveLocalizedName(recipe, locale);
  const revisionName = revision ? resolveLocalizedName(revision, locale) : '';
  const name = frozenName || revisionName || recipe.paletteId;
  return { palette, revision, name };
}

function RecipeFactChip({
  recipe,
  wordPalettes,
  termById,
  locale,
  labels,
  sourceLabel,
}: {
  recipe: PromptCommonRecipeReferenceDto;
  wordPalettes: WordPaletteDto[];
  termById: Map<string, TermListItem>;
  locale: Locale;
  labels: Labels;
  sourceLabel(source: PromptPackSourceReferenceDto): string;
}) {
  const { revision, name } = recipeRecord(recipe, wordPalettes, locale);
  const parameters =
    revision?.parameters.flatMap((parameter) => {
      const value = recipe.parameterValues[parameter.stableKey];
      const option = parameter.options.find((item) => item.value === value);
      if (!option) return [];
      return [
        {
          id: parameter.id,
          name: resolveWordPaletteParameterName(parameter, locale),
          value: resolveWordPaletteOptionLabel(option, locale),
        },
      ];
    }) ??
    recipe.parameters.map((parameter) => ({
      id: parameter.parameterRevisionId,
      name: parameter.stableKey,
      value: parameter.valueKey,
    }));

  return (
    <HoverCard openDelay={240} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          data-history-recipe-id={recipe.paletteId}
          className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border bg-background px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <DictionaryIcon className="size-3.5 shrink-0" />
          <span className="truncate">{name}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="start" className="grid w-96 max-w-[calc(100vw-2rem)] gap-3">
        <header className="flex items-baseline justify-between gap-3">
          <strong className="min-w-0 truncate text-sm">{name}</strong>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {labels.revision} {revision?.revisionNo ?? recipe.paletteRevisionId}
          </span>
        </header>
        {parameters.length > 0 && (
          <section className="grid gap-1.5">
            <span className="text-[11px] text-muted-foreground">{labels.parameters}</span>
            {parameters.map((parameter) => (
              <div key={parameter.id} className="flex items-baseline justify-between gap-4 text-xs">
                <span className="text-muted-foreground">{parameter.name}</span>
                <span className="text-right">{parameter.value}</span>
              </div>
            ))}
          </section>
        )}
        {recipe.terms.length > 0 && (
          <section className="grid gap-1.5">
            <span className="text-[11px] text-muted-foreground">{labels.terms}</span>
            <div className="flex flex-wrap gap-1.5">
              {recipe.terms.map((term) => (
                <Badge key={`${term.termId}:${term.termRevisionId}`} variant="secondary">
                  {localizedTermName(termById.get(term.termId), term.termId, locale)}
                </Badge>
              ))}
            </div>
          </section>
        )}
        {(recipe.packSources?.length ?? 0) > 0 && (
          <section className="grid gap-1.5">
            <span className="text-[11px] text-muted-foreground">{labels.sources}</span>
            <div className="flex flex-wrap gap-1.5">
              {recipe.packSources!.map((source) => (
                <Badge key={source.packReleaseItemId} variant="outline">
                  {sourceLabel(source)}
                </Badge>
              ))}
            </div>
          </section>
        )}
        <footer className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <DictionaryIcon className="size-3" />
            {recipe.terms.length}
          </span>
          <span className="inline-flex items-center gap-1">
            <ImageIcon className="size-3" />
            {recipe.references.length}
          </span>
        </footer>
      </HoverCardContent>
    </HoverCard>
  );
}

function FactText({ label, children }: { label: string; children: string }) {
  return (
    <section className="grid gap-1.5" data-generation-fact-layer={label}>
      <span className="font-medium">{label}</span>
      <p className="whitespace-pre-wrap break-words rounded-md border bg-background/70 p-2 font-mono leading-relaxed">
        {children}
      </p>
    </section>
  );
}

function FullExecutionRequest({
  runId,
  summaryActualRequest,
  label,
}: {
  runId: string;
  summaryActualRequest: Record<string, unknown> | undefined;
  label: string;
}) {
  const [actualRequest, setActualRequest] = useState<Record<string, unknown> | null | undefined>(summaryActualRequest);
  const [loaded, setLoaded] = useState(summaryActualRequest !== undefined);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <details
      className="rounded-md border bg-background/70"
      onToggle={(event) => {
        if (!event.currentTarget.open || loaded || loading) return;
        setLoading(true);
        void window.desktopApi
          .generationExecutionRequest(runId)
          .then((request) => {
            if (!mounted.current) return;
            setActualRequest(request);
            setLoaded(true);
          })
          .catch(() => undefined)
          .finally(() => {
            if (mounted.current) setLoading(false);
          });
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 font-medium">
        <BracesIcon className="size-3.5" />
        {label}
      </summary>
      <pre className="max-h-72 overflow-auto border-t p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-all">
        {JSON.stringify(actualRequest ?? {}, null, 2)}
      </pre>
    </details>
  );
}

function isImageEditActualRequest(actualRequest: Record<string, unknown> | undefined) {
  return actualRequest?.operation === 'EDIT';
}

export function GenerationFactLayers({ version, run, locale, terms, wordPalettes, labels }: Props) {
  const promptSnapshot = version.promptInputSnapshot;
  const executionSnapshot = run.executionInputSnapshot ?? null;
  const executionSummary =
    run.executionSummary ??
    (executionSnapshot
      ? {
          id: executionSnapshot.id,
          requestSchema: executionSnapshot.requestSchema,
          resolvedPrompt: executionSnapshot.commonInput.resolvedPrompt.commonExpression,
          clientRequestText: executionSnapshot.clientRequestText,
        }
      : null);
  const summaryActualRequest = executionSnapshot?.actualRequest;
  const termById = new Map(terms.map((term) => [term.id, term]));
  const sourceReferences = useMemo(
    () => [
      ...promptSnapshot.commonInput.directTerms.flatMap((term) => term.packSources ?? []),
      ...promptSnapshot.commonInput.recipes.flatMap((recipe) => recipe.packSources ?? []),
    ],
    [promptSnapshot],
  );
  const [packLabels, setPackLabels] = useState<Map<string, string>>(() => new Map());

  useEffect(() => {
    if (sourceReferences.length === 0) return;
    let alive = true;
    void window.desktopApi
      .packsList()
      .then((catalog) => {
        if (!alive) return;
        const labelsBySource = new Map<string, string>();
        for (const item of catalog) {
          for (const release of item.releases) {
            labelsBySource.set(`${item.pack.id}:${release.id}`, `${item.pack.displayName} · ${release.version}`);
          }
        }
        setPackLabels(labelsBySource);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sourceReferences]);

  const sourceLabel = (source: PromptPackSourceReferenceDto) =>
    packLabels.get(`${source.packId}:${source.packReleaseId}`) ?? `${source.packId} · ${source.packReleaseId}`;

  const common = promptSnapshot.commonInput;
  const composed = promptSnapshot.sourceKind === 'COMPOSED';
  const userInstruction = composed ? common.userInstruction : '';
  const flatPrompt = composed ? '' : (common.flatPrompt ?? '');
  const model = run.modelSnapshot?.descriptor;
  const actualLabel = model?.name ? `${labels.actualRequest} · ${model.name}` : labels.actualRequest;
  const hasStructuredReferences =
    common.directTerms.length > 0 || common.recipes.length > 0 || common.directReferences.length > 0;
  // Codex snapshots retain the complete CLI stdin as an execution audit fact.
  // The user-visible image Prompt instead comes from the independently frozen,
  // model-neutral execution input. The raw envelope remains available only in
  // the collapsed execution diagnostics below.
  const storedClientRequestText = executionSummary?.clientRequestText ?? '';
  const isImageEditRequest = Boolean(
    isImageEditActualRequest(summaryActualRequest) || version.sourceImageId || run.derivation,
  );
  const clientRequestText = isImageEditRequest
    ? (executionSummary?.resolvedPrompt ?? '')
    : executionSummary?.requestSchema === 'codex-cli-imagegen.v1'
      ? executionSummary.resolvedPrompt
      : storedClientRequestText;

  return (
    <div className="grid gap-3" data-generation-fact-layers>
      {userInstruction.trim() && <FactText label={labels.userInstruction}>{userInstruction}</FactText>}
      {flatPrompt.trim() && <FactText label={labels.flatPrompt}>{flatPrompt}</FactText>}
      {composed && hasStructuredReferences && (
        <section className="grid gap-1.5" data-generation-fact-layer="creation-input">
          <span className="font-medium">{labels.creationInput}</span>
          <div className="flex flex-wrap gap-1.5">
            {common.directTerms.map((term) => (
              <Badge
                key={`${term.termId}:${term.termRevisionId}`}
                variant="secondary"
                data-history-direct-term-id={term.termId}
                title={term.packSources?.map(sourceLabel).join('\n') || undefined}
              >
                {localizedTermName(termById.get(term.termId), term.termId, locale)}
              </Badge>
            ))}
            {common.recipes.map((recipe) => (
              <RecipeFactChip
                key={recipe.useId}
                recipe={recipe}
                wordPalettes={wordPalettes}
                termById={termById}
                locale={locale}
                labels={labels}
                sourceLabel={sourceLabel}
              />
            ))}
            {common.directReferences.length > 0 && (
              <Badge variant="outline" className="gap-1">
                <ImageIcon className="size-3.5" />
                {labels.references} {common.directReferences.length}
              </Badge>
            )}
          </div>
        </section>
      )}
      {clientRequestText.trim() && <FactText label={actualLabel}>{clientRequestText}</FactText>}
      {run.providerReturnedDescriptions?.map((description) => (
        <FactText
          key={description.id}
          label={`${labels.providerReturnedDescription} · ${description.fieldName}${description.interpretation ? ` · ${description.interpretation}` : ''}`}
        >
          {description.rawValue}
        </FactText>
      ))}
      {executionSummary && (
        <FullExecutionRequest
          key={executionSummary.id}
          runId={run.id}
          summaryActualRequest={summaryActualRequest}
          label={labels.fullRequest}
        />
      )}
    </div>
  );
}
