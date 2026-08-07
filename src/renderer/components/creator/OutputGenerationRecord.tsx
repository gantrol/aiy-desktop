import { useEffect, useMemo, useState } from 'react';
import { ChevronRightIcon, LoaderCircleIcon, SquareArrowOutUpRightIcon } from 'lucide-react';
import type {
  ImageGenerationRouteDto,
  ImportedCreationOutputDto,
  Locale,
  PromptSeriesDto,
  TermListItem,
  WordPaletteDto,
} from '@/shared/contracts';
import { DictionaryIcon } from '@/renderer/icons';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { ComboboxInput } from '@/renderer/components/ui/combobox-input';
import { Input } from '@/renderer/components/ui/input';
import { Textarea } from '@/renderer/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { useProvenanceSuggestions } from '@/renderer/components/provenance/useProvenanceSuggestions';
import { GenerationFactLayers } from '@/renderer/components/creator/GenerationFactLayers';
import {
  comparisonVersionReferenceNames,
  linkedPromptVersion,
} from '@/renderer/components/creator/generationComparisonUtils';
import { importedGenerationTextType } from '@/renderer/components/creator/imageImport';
import type { CreationExperimentContext } from '@/renderer/components/creator/creationExperimentContext';

interface Props {
  series: PromptSeriesDto | undefined;
  experimentContext?: CreationExperimentContext | null;
  assetId: string;
  locale: Locale;
  terms: TermListItem[];
  wordPalettes: WordPaletteDto[];
  imageGenerationRoutes: ImageGenerationRouteDto[];
  onImportedOutputSaved(output: ImportedCreationOutputDto): void;
  notify(message: string): void;
}

function fileSize(bytes: number | undefined) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function OutputGenerationRecord({
  series,
  experimentContext = null,
  assetId,
  locale,
  terms,
  wordPalettes,
  imageGenerationRoutes,
  onImportedOutputSaved,
  notify,
}: Props) {
  const { messages } = useI18n();
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [note, setNote] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [promptVersionId, setPromptVersionId] = useState<string | null>(null);
  const [aiGeneratedStatus, setAiGeneratedStatus] = useState<ImportedCreationOutputDto['aiGeneratedStatus']>('UNKNOWN');
  const [modelNameDraft, setModelNameDraft] = useState('');
  const [modelProvider, setModelProvider] = useState('');
  const [modelVersion, setModelVersion] = useState('');
  const [generationText, setGenerationText] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedBaseline, setSavedBaseline] = useState<ImportedCreationOutputDto | null>(null);
  const l = messages.creator.generationRecord;
  const platformDefaults = useMemo(
    () => [
      l.platformOfficialApi,
      l.platformOpenRouter,
      l.platformChatGptApp,
      l.platformCodex,
      l.platformGeminiApp,
      l.platformDoubao,
      l.platformLocal,
    ],
    [
      l.platformChatGptApp,
      l.platformCodex,
      l.platformDoubao,
      l.platformGeminiApp,
      l.platformLocal,
      l.platformOfficialApi,
      l.platformOpenRouter,
    ],
  );
  const generatedRecord = useMemo(() => {
    for (const version of series?.versions ?? []) {
      const run = version.runs.find((item) => item.asset?.id === assetId);
      if (run) return { version, run };
    }
    return null;
  }, [assetId, series]);
  const importedRecord = useMemo(
    () => (series?.importedOutputs ?? []).find((item) => item.asset.id === assetId) ?? null,
    [assetId, series],
  );
  const transformedRecord = useMemo(
    () => (series?.transformedOutputs ?? []).find((item) => item.asset.id === assetId) ?? null,
    [assetId, series],
  );
  const provenanceSuggestions = useProvenanceSuggestions(platformDefaults, Boolean(importedRecord && open));

  useEffect(() => {
    setOpen(false);
    setDisplayName(importedRecord?.displayName ?? '');
    setNote(importedRecord?.note ?? '');
    setSourceUrl(importedRecord?.sourceUrl ?? '');
    setPromptVersionId(importedRecord?.promptVersionId ?? null);
    setAiGeneratedStatus(importedRecord?.aiGeneratedStatus ?? 'UNKNOWN');
    setModelNameDraft(importedRecord?.modelName ?? '');
    setModelProvider(importedRecord?.modelProvider ?? '');
    setModelVersion(importedRecord?.modelVersion ?? '');
    setGenerationText(importedRecord?.generationText ?? '');
    setSavedBaseline(null);
  }, [
    assetId,
    importedRecord?.id,
    importedRecord?.displayName,
    importedRecord?.note,
    importedRecord?.sourceUrl,
    importedRecord?.promptVersionId,
    importedRecord?.aiGeneratedStatus,
    importedRecord?.modelName,
    importedRecord?.modelProvider,
    importedRecord?.modelVersion,
    importedRecord?.generationText,
  ]);
  if (!generatedRecord && !importedRecord && !transformedRecord) return null;

  const linkedImportedVersion = importedRecord
    ? linkedPromptVersion(importedRecord, series?.versions ?? [])
    : undefined;
  const version = generatedRecord?.version ?? linkedImportedVersion;
  const asset = generatedRecord?.run.asset ?? importedRecord?.asset ?? transformedRecord?.asset;
  if (!asset) return null;
  const inputReferenceNames = version ? comparisonVersionReferenceNames(version, locale, terms, wordPalettes) : [];
  const referenceCount = inputReferenceNames.length;
  const generatedModel = generatedRecord
    ? (generatedRecord.run.modelSnapshot?.descriptor ??
      imageGenerationRoutes.find((model) => model.key === generatedRecord.run.modelKey))
    : undefined;
  const modelName = generatedRecord ? (generatedModel?.name ?? generatedRecord.run.modelKey) : '';
  const codexTask = generatedRecord?.run.codexTask ?? importedRecord?.codexTask ?? null;
  const baseline = savedBaseline?.id === importedRecord?.id ? savedBaseline : importedRecord;
  // Preserve a historical execution link while the recorded model is
  // untouched. A free-text provenance model never becomes an API route by
  // merely sharing its display name.
  const modelKey = modelNameDraft.trim() === baseline?.modelName.trim() ? (baseline?.modelKey ?? null) : null;
  const comparisonRole: ImportedCreationOutputDto['comparisonRole'] =
    aiGeneratedStatus === 'NO' ? 'ACTUAL' : modelNameDraft.trim() ? 'MODEL' : 'UNKNOWN';
  const timestamp = importedRecord?.createdAt ?? transformedRecord?.createdAt ?? asset.createdAt;
  const generationTextType = importedGenerationTextType(aiGeneratedStatus);
  const generationTextLabel = aiGeneratedStatus === 'YES' ? l.exactPrompt : l.description;
  const generatedVersionLabel = generatedRecord
    ? experimentContext?.slot.versionId === generatedRecord.version.id
      ? experimentContext.versionLabel
      : `V${String(generatedRecord.version.versionNo).padStart(2, '0')}`
    : '';
  const linkedImportedVersionLabel = linkedImportedVersion
    ? `V${String(linkedImportedVersion.versionNo).padStart(2, '0')}`
    : '';
  const importedDirty =
    Boolean(baseline) &&
    (displayName !== baseline!.displayName ||
      note !== baseline!.note ||
      sourceUrl !== baseline!.sourceUrl ||
      promptVersionId !== baseline!.promptVersionId ||
      aiGeneratedStatus !== baseline!.aiGeneratedStatus ||
      comparisonRole !== baseline!.comparisonRole ||
      modelKey !== baseline!.modelKey ||
      modelNameDraft !== baseline!.modelName ||
      modelProvider !== baseline!.modelProvider ||
      modelVersion !== baseline!.modelVersion ||
      generationTextType !== baseline!.generationTextType ||
      generationText !== baseline!.generationText);

  function changeAiStatus(value: ImportedCreationOutputDto['aiGeneratedStatus']) {
    setAiGeneratedStatus(value);
    if (value === 'NO') {
      setModelNameDraft('');
      setModelProvider('');
      setModelVersion('');
    }
  }

  function changeModelName(value: string) {
    setModelNameDraft(value);
    if (value.trim() && aiGeneratedStatus === 'UNKNOWN') setAiGeneratedStatus('YES');
  }

  async function saveImportedMetadata() {
    if (!importedRecord || !displayName.trim() || saving) return;
    setSaving(true);
    try {
      const updated = await window.desktopApi.creatorOutputUpdate({
        outputId: importedRecord.id,
        promptVersionId,
        displayName,
        note,
        sourceUrl,
        aiGeneratedStatus,
        comparisonRole,
        modelKey,
        modelName: modelNameDraft,
        modelProvider,
        modelVersion,
        generationTextType,
        generationText,
      });
      setDisplayName(updated.displayName);
      setNote(updated.note);
      setSourceUrl(updated.sourceUrl);
      setPromptVersionId(updated.promptVersionId);
      setAiGeneratedStatus(updated.aiGeneratedStatus);
      setModelNameDraft(updated.modelName);
      setModelProvider(updated.modelProvider);
      setModelVersion(updated.modelVersion);
      setGenerationText(updated.generationText);
      setSavedBaseline(updated);
      provenanceSuggestions.remember(updated.modelName, updated.modelProvider);
      // The returned row is already authoritative. Patch it into the
      // workbench instead of holding Save behind a full bootstrap reload.
      onImportedOutputSaved(updated);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  async function openCodex(threadId: string) {
    try {
      await window.desktopApi.codexOpenThread(threadId);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <section className="shrink-0 border-t border-border/60 bg-secondary">
      <button
        type="button"
        data-action="output-generation-record"
        className="flex h-10 w-full items-center gap-2 px-3 text-left text-xs hover:bg-muted/60"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRightIcon className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="font-medium">{l.details}</span>
        <span className="text-muted-foreground">
          {generatedRecord
            ? `${generatedVersionLabel}${experimentContext?.slot.versionId === generatedRecord.version.id ? ` · ${locale === 'zh' ? '方向实验' : 'Experiment'} · ${experimentContext.slot.label}` : ''} · ${modelName}`
            : transformedRecord
              ? `${messages.creator.imageTransform.crop} · ${transformedRecord.ratioWidth}:${transformedRecord.ratioHeight}`
              : `${l.imported}${linkedImportedVersionLabel ? ` · ${linkedImportedVersionLabel}` : ''}`}
        </span>
        {referenceCount > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
            <DictionaryIcon className="size-3.5" />
            {referenceCount}
          </span>
        )}
      </button>
      {open && (
        <div className="flex max-h-[45vh] min-h-0 flex-col border-t border-border/50 text-xs">
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <div className="grid gap-3">
              {importedRecord && (
                <div className="grid gap-2">
                  <Input
                    className="h-8"
                    value={displayName}
                    aria-label={l.name}
                    placeholder={l.name}
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                  <Input
                    className="h-8"
                    type="url"
                    value={sourceUrl}
                    aria-label={l.sourceUrl}
                    placeholder={l.sourceUrl}
                    onChange={(event) => setSourceUrl(event.target.value)}
                  />
                  <Select
                    value={promptVersionId ?? '__none'}
                    onValueChange={(value) => setPromptVersionId(value === '__none' ? null : value)}
                  >
                    <SelectTrigger aria-label={l.creationInputLink}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{l.notLinked}</SelectItem>
                      {[...(series?.versions ?? [])]
                        .sort((left, right) => right.versionNo - left.versionNo)
                        .map((item) => {
                          const summary =
                            item.changeSummary === 'MANUAL_PROMPT'
                              ? locale === 'zh'
                                ? '初始 Prompt'
                                : 'Initial Prompt'
                              : item.changeSummary === 'EXTERNAL_IMPORT'
                                ? l.imported
                                : item.changeSummary;
                          return (
                            <SelectItem key={item.id} value={item.id}>
                              V{String(item.versionNo).padStart(2, '0')}
                              {summary.trim() ? ` · ${summary}` : ''}
                            </SelectItem>
                          );
                        })}
                    </SelectContent>
                  </Select>
                  <Select
                    value={aiGeneratedStatus}
                    onValueChange={(value) => changeAiStatus(value as ImportedCreationOutputDto['aiGeneratedStatus'])}
                  >
                    <SelectTrigger aria-label={l.aiGeneratedLabel}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="UNKNOWN">{l.unknown}</SelectItem>
                      <SelectItem value="YES">{l.aiGenerated}</SelectItem>
                      <SelectItem value="NO">{l.notAiGenerated}</SelectItem>
                      <SelectItem value="OTHER">{l.otherProvenance}</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="grid grid-cols-2 gap-2">
                    <ComboboxInput
                      value={modelNameDraft}
                      suggestions={provenanceSuggestions.modelNames}
                      disabled={aiGeneratedStatus === 'NO'}
                      aria-label={l.model}
                      placeholder={l.modelPlaceholder}
                      openLabel={l.modelOptions}
                      onValueChange={changeModelName}
                    />
                    <ComboboxInput
                      value={modelProvider}
                      suggestions={provenanceSuggestions.platforms}
                      disabled={aiGeneratedStatus === 'NO'}
                      aria-label={l.platform}
                      placeholder={l.platformPlaceholder}
                      openLabel={l.platformOptions}
                      onValueChange={setModelProvider}
                    />
                    <Input
                      className="col-span-2 h-8"
                      value={modelVersion}
                      disabled={aiGeneratedStatus === 'NO'}
                      aria-label={l.version}
                      placeholder={l.version}
                      onChange={(event) => setModelVersion(event.target.value)}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <span className="font-medium">{generationTextLabel}</span>
                    <Textarea
                      className="min-h-20"
                      value={generationText}
                      aria-label={generationTextLabel}
                      placeholder={generationTextLabel}
                      onChange={(event) => setGenerationText(event.target.value)}
                    />
                  </div>
                  <Textarea
                    className="min-h-16"
                    value={note}
                    aria-label={l.note}
                    placeholder={l.note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </div>
              )}
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                {importedRecord?.originalName && (
                  <>
                    <dt className="text-muted-foreground">{l.originalName}</dt>
                    <dd className="truncate">{importedRecord.originalName}</dd>
                  </>
                )}
                {generatedRecord && (
                  <>
                    <dt className="text-muted-foreground">{l.model}</dt>
                    <dd>
                      {modelName}
                      {generatedModel?.provider ? ` · ${generatedModel.provider}` : ''}
                    </dd>
                  </>
                )}
                {codexTask && (
                  <>
                    <dt className="text-muted-foreground">{l.codexTask}</dt>
                    <dd className="flex min-w-0 items-center gap-2">
                      <Badge variant="secondary" className="shrink-0">
                        {l.codexRecorded}
                      </Badge>
                      <span className="min-w-0 flex-1 truncate" title={codexTask.threadName}>
                        {codexTask.threadName}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 shrink-0"
                        onClick={() => void openCodex(codexTask.threadId)}
                      >
                        <SquareArrowOutUpRightIcon className="size-3.5" />
                        {l.openCodex}
                      </Button>
                    </dd>
                  </>
                )}
                {transformedRecord && (
                  <>
                    <dt className="text-muted-foreground">{messages.creator.imageTransform.title}</dt>
                    <dd>
                      {transformedRecord.ratioWidth}:{transformedRecord.ratioHeight}
                    </dd>
                  </>
                )}
                {version && (
                  <>
                    <dt className="text-muted-foreground">{l.version}</dt>
                    <dd>
                      {experimentContext?.slot.versionId === version.id
                        ? experimentContext.versionLabel
                        : `V${String(version.versionNo).padStart(2, '0')}`}
                    </dd>
                  </>
                )}
                <dt className="text-muted-foreground">{l.dimensions}</dt>
                <dd>
                  {asset.width} × {asset.height}
                </dd>
                <dt className="text-muted-foreground">{l.format}</dt>
                <dd>{asset.mimeType.replace('image/', '').toUpperCase()}</dd>
                <dt className="text-muted-foreground">{l.fileSize}</dt>
                <dd>{fileSize(asset.byteSize)}</dd>
                <dt className="text-muted-foreground">{l.added}</dt>
                <dd>
                  {new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(new Date(timestamp))}
                </dd>
              </dl>
              {importedRecord && linkedImportedVersion && inputReferenceNames.length > 0 && (
                <section className="grid gap-1.5" data-imported-linked-creation-input={linkedImportedVersion.id}>
                  <span className="font-medium">
                    {l.creationInput} · {linkedImportedVersionLabel}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {inputReferenceNames.map((name) => (
                      <Badge key={name} variant="secondary">
                        {name}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}
              {generatedRecord && (
                <GenerationFactLayers
                  version={generatedRecord.version}
                  run={generatedRecord.run}
                  locale={locale}
                  terms={terms}
                  wordPalettes={wordPalettes}
                  labels={{
                    userInstruction: l.userInstruction,
                    creationInput: l.creationInput,
                    actualRequest: l.actualRequest,
                    flatPrompt: l.flatPrompt,
                    fullRequest: l.fullRequest,
                    revision: l.revision,
                    parameters: l.parameters,
                    terms: l.terms,
                    references: l.references,
                    sources: l.sources,
                    providerReturnedDescription: l.providerReturnedDescription,
                  }}
                />
              )}
            </div>
          </div>
          {importedRecord && (
            <div className="flex shrink-0 justify-end border-t border-border/50 bg-secondary px-3 py-2">
              <Button
                type="button"
                size="sm"
                disabled={saving || !displayName.trim() || !importedDirty}
                onClick={() => void saveImportedMetadata()}
              >
                {saving && <LoaderCircleIcon className="size-3.5 animate-spin" />}
                {l.save}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
