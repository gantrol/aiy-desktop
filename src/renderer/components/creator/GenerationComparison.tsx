import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleIcon, Columns2Icon, Maximize2Icon, Minimize2Icon, PlusIcon } from 'lucide-react';
import type {
  ImageGenerationRouteDto,
  GenerationInput,
  GenerationRunDto,
  GenerationTaskDto,
  GenerationVersionInput,
  ImportedCreationOutputDto,
  Locale,
  PromptSeriesDto,
  PromptVersionDto,
  TermListItem,
  WordPaletteDto,
} from '@/shared/contracts';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { StatusDot } from '@/renderer/components/ui/status-dot';
import { generationPhaseLabel } from '@/renderer/components/generation/task-presentation';
import { generationErrorPresentation } from '@/renderer/components/generation/generation-error-presentation';
import {
  VirtualGrid,
  type VirtualGridAnchor,
  type VirtualGridCell,
  type VirtualGridHandle,
} from '@/renderer/components/ui/virtual-grid';
import { ComparisonModelPicker } from '@/renderer/components/creator/ComparisonModelPicker';
import { ComparisonModelHeader } from '@/renderer/components/creator/ComparisonModelHeader';
import { ComparisonPromptCell, type PromptDisplayMode } from '@/renderer/components/creator/ComparisonPromptCell';
import { ComparisonResultStack } from '@/renderer/components/creator/ComparisonResultStack';
import { GenerationFailureState } from '@/renderer/components/creator/GenerationFailureState';
import { FullWindowComparison } from '@/renderer/components/creator/FullWindowComparison';
import {
  collectVisibleComparisonModelKeys,
  comparisonImportedPromptRowId,
  comparisonLinkedImportedPromptRowId,
  comparisonVersionReferenceNames,
  comparisonVersionGroupRowId,
  filterKnownComparisonModels,
  groupEquivalentPromptVersions,
  importedPromptPlacement,
  normalizedComparisonPrompt,
} from '@/renderer/components/creator/generationComparisonUtils';
import { PairComparisonView, type PairComparisonItem } from '@/renderer/components/creator/PairComparisonView';

interface Props {
  series: PromptSeriesDto;
  locale: Locale;
  terms: TermListItem[];
  wordPalettes: WordPaletteDto[];
  routes: ImageGenerationRouteDto[];
  tasks: GenerationTaskDto[];
  fullWindow: boolean;
  onFullWindowChange(open: boolean): void;
  onSelectAsset(assetId: string): void;
  onGenerate(input: GenerationVersionInput): Promise<void>;
  onGeneratePrompt(input: GenerationInput): Promise<void>;
  onRetry(runId: string): Promise<void>;
  onReEdit(runId: string): void;
  notify(message: string): void;
}

type AxisMode = 'MODEL' | 'REPEAT';
type PairSlot = 'A' | 'B';

type ComparisonColumn =
  { kind: 'MODEL'; key: string; model: ImageGenerationRouteDto } | { kind: 'REPEAT'; key: string; repeatIndex: number };

interface ComparisonRow {
  id: string;
  label: string;
  version: PromptVersionDto | null;
  baseVersionId: string | null;
  versionIds: string[];
  changeSummary: string;
  prompt: string;
  previousPrompt: string;
  fullPrompt: string;
  termNames: string[];
  runs: GenerationRunDto[];
}

const actualColumnKey = '__comparison_actual';
const unknownColumnKey = '__comparison_unknown';

function importedExecutionRouteKey(output: ImportedCreationOutputDto) {
  return output.executionRouteKey ?? output.modelKey ?? null;
}

function importedColumnKey(output: ImportedCreationOutputDto) {
  if (output.comparisonRole === 'ACTUAL') return actualColumnKey;
  if (output.comparisonRole !== 'MODEL') return unknownColumnKey;
  const executionRouteKey = importedExecutionRouteKey(output);
  if (executionRouteKey) return executionRouteKey;
  if (!output.modelName.trim()) return unknownColumnKey;
  return `external:${[output.modelProvider, output.modelName, output.modelVersion]
    .map((value) => encodeURIComponent(value.trim().toLocaleLowerCase()))
    .join(':')}`;
}

function importedRun(output: ImportedCreationOutputDto): GenerationRunDto {
  return {
    id: `import:${output.id}`,
    modelKey: importedColumnKey(output),
    status: 'SUCCEEDED',
    canvasPresetKey: null,
    width: output.asset.width,
    height: output.asset.height,
    quality: 'low',
    asset: output.asset,
    derivation: null,
    errorMessage: null,
    createdAt: output.createdAt,
  };
}

function chronological(runs: GenerationRunDto[]) {
  return [...runs].sort(
    (left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

function comparisonGenerationSettings(
  sourceRun: GenerationRunDto | undefined,
  model: ImageGenerationRouteDto | undefined,
): Pick<GenerationVersionInput, 'canvasPresetKey' | 'width' | 'height' | 'quality'> {
  const sourceWidth = sourceRun?.width ?? null;
  const sourceHeight = sourceRun?.height ?? null;
  const validDimensions =
    sourceWidth !== null &&
    sourceHeight !== null &&
    Number.isInteger(sourceWidth) &&
    Number.isInteger(sourceHeight) &&
    sourceWidth >= 256 &&
    sourceWidth <= 4096 &&
    sourceHeight >= 256 &&
    sourceHeight <= 4096;
  const preferredQuality = sourceRun?.quality ?? 'low';
  const quality =
    model?.qualityMode === 'SELECTABLE' && !model.supportedQualities.includes(preferredQuality)
      ? (model.supportedQualities[0] ?? preferredQuality)
      : preferredQuality;
  return {
    canvasPresetKey: validDimensions ? (sourceRun?.canvasPresetKey ?? null) : null,
    width: validDimensions ? sourceWidth : null,
    height: validDimensions ? sourceHeight : null,
    quality,
  };
}

function versionGroupLabel(versions: PromptVersionDto[]) {
  const numbers = versions.map((version) => version.versionNo).sort((left, right) => left - right);
  const label = (versionNo: number) => `V${String(versionNo).padStart(2, '0')}`;
  if (numbers.length === 1) return label(numbers[0]);
  const consecutive = numbers.every((versionNo, index) => index === 0 || versionNo === numbers[index - 1] + 1);
  return consecutive ? `${label(numbers[0])}–${label(numbers.at(-1)!)}` : numbers.map(label).join('/');
}

function versionInstruction(version: PromptVersionDto) {
  const snapshot = version.promptInputSnapshot;
  return snapshot.sourceKind === 'COMPOSED'
    ? snapshot.commonInput.userInstruction
    : (snapshot.commonInput.flatPrompt ?? '');
}

export function GenerationComparison({
  series,
  locale,
  terms,
  wordPalettes,
  routes,
  tasks,
  fullWindow,
  onFullWindowChange,
  onSelectAsset,
  onGenerate,
  onGeneratePrompt,
  onRetry,
  onReEdit,
  notify,
}: Props) {
  const { messages } = useI18n();
  const l = messages.creator.comparison;
  const fullWindowButtonRef = useRef<HTMLButtonElement>(null);
  const pairButtonRef = useRef<HTMLButtonElement>(null);
  const matrixScrollRef = useRef<VirtualGridHandle>(null);
  const pairMatrixAnchor = useRef<VirtualGridAnchor | null>(null);
  const expandedBeforePair = useRef(false);
  const modelLabel = (model: ImageGenerationRouteDto) =>
    model.key === 'internal-library-random' ? messages.creator.generationTargets.internalLibraryRandom : model.name;
  const versions = useMemo(
    () => [...series.versions].sort((left, right) => right.versionNo - left.versionNo),
    [series.versions],
  );
  const importedOutputs = useMemo(() => series.importedOutputs ?? [], [series.importedOutputs]);
  const rows = useMemo(() => {
    const importedOutputIds = new Set(importedOutputs.map((output) => output.id));
    const derivedVersionsByImportId = new Map<string, PromptVersionDto[]>();
    const derivedVersionIds = new Set<string>();
    for (const version of versions) {
      if (!version.sourceImportId || !importedOutputIds.has(version.sourceImportId)) continue;
      derivedVersionIds.add(version.id);
      derivedVersionsByImportId.set(version.sourceImportId, [
        ...(derivedVersionsByImportId.get(version.sourceImportId) ?? []),
        version,
      ]);
    }
    const baseVersions = versions.filter((version) => !derivedVersionIds.has(version.id));
    const versionGroups = groupEquivalentPromptVersions(baseVersions);
    const versionById = new Map(baseVersions.map((version) => [version.id, version]));
    const groupIndexByVersionId = new Map(
      versionGroups.flatMap((group, groupIndex) => group.map((version) => [version.id, groupIndex] as const)),
    );
    const importedByGroup = new Map<number, GenerationRunDto[]>();
    const linkedVariantsByGroup = new Map<
      number,
      Map<
        string,
        {
          version: PromptVersionDto;
          prompt: string;
          baselinePrompt: string;
          sourceImportIds: string[];
          runs: GenerationRunDto[];
        }
      >
    >();
    const standaloneByPrompt = new Map<
      string,
      { prompt: string; sourceImportIds: string[]; runs: GenerationRunDto[] }
    >();
    const unbound: GenerationRunDto[] = [];
    for (const output of importedOutputs) {
      const run = importedRun(output);
      const placement = importedPromptPlacement(output, baseVersions);
      if (placement.kind === 'VERSION') {
        const groupIndex = groupIndexByVersionId.get(placement.versionId);
        if (groupIndex === undefined) {
          unbound.push(run);
          continue;
        }
        const current = importedByGroup.get(groupIndex) ?? [];
        current.push(run);
        importedByGroup.set(groupIndex, current);
        continue;
      }
      if (placement.kind === 'LINKED_VARIANT') {
        const groupIndex = groupIndexByVersionId.get(placement.versionId);
        const linkedVersion = versionById.get(placement.versionId);
        if (groupIndex === undefined || !linkedVersion) {
          unbound.push(run);
          continue;
        }
        const variants = linkedVariantsByGroup.get(groupIndex) ?? new Map();
        const key = comparisonLinkedImportedPromptRowId(placement.versionId, placement.prompt);
        const current = variants.get(key) ?? {
          version: linkedVersion,
          prompt: placement.prompt,
          baselinePrompt: placement.baselinePrompt,
          sourceImportIds: [],
          runs: [],
        };
        current.sourceImportIds.push(output.id);
        current.runs.push(run);
        variants.set(key, current);
        linkedVariantsByGroup.set(groupIndex, variants);
        continue;
      }
      if (placement.kind === 'STANDALONE') {
        const key = normalizedComparisonPrompt(placement.prompt);
        const current = standaloneByPrompt.get(key) ?? { prompt: placement.prompt, sourceImportIds: [], runs: [] };
        current.sourceImportIds.push(output.id);
        current.runs.push(run);
        standaloneByPrompt.set(key, current);
        continue;
      }
      unbound.push(run);
    }
    const derivedVersionsFor = (sourceImportIds: readonly string[]) =>
      sourceImportIds
        .flatMap((sourceImportId) => derivedVersionsByImportId.get(sourceImportId) ?? [])
        .sort((left, right) => left.versionNo - right.versionNo || left.id.localeCompare(right.id));
    const promptRows = versionGroups
      .map((group, groupIndex) => {
        const version = group.at(-1)!;
        const groupIds = new Set(group.map((item) => item.id));
        let previousVersion = version.parentVersionId ? versionById.get(version.parentVersionId) : undefined;
        while (previousVersion && groupIds.has(previousVersion.id)) {
          previousVersion = previousVersion.parentVersionId
            ? versionById.get(previousVersion.parentVersionId)
            : undefined;
        }
        const row: ComparisonRow = {
          id: comparisonVersionGroupRowId(group),
          label: versionGroupLabel(group),
          version,
          baseVersionId: null,
          versionIds: group.map((item) => item.id),
          changeSummary:
            group[0].changeSummary === 'MANUAL_PROMPT'
              ? locale === 'zh'
                ? '初始 Prompt'
                : 'Initial Prompt'
              : group[0].changeSummary === 'EXTERNAL_IMPORT'
                ? l.importedPrompt
                : group[0].changeSummary,
          prompt: versionInstruction(version),
          previousPrompt: previousVersion
            ? versionInstruction(previousVersion)
            : versionGroups[groupIndex - 1]?.at(-1)
              ? versionInstruction(versionGroups[groupIndex - 1].at(-1)!)
              : '',
          fullPrompt: versionInstruction(version),
          termNames: comparisonVersionReferenceNames(version, locale, terms, wordPalettes),
          runs: [
            ...group.flatMap((item) => item.runs).filter((run) => run.outputDisposition !== 'FAILED'),
            ...(importedByGroup.get(groupIndex) ?? []),
          ],
        };
        return { groupIndex, row };
      })
      .reverse()
      .flatMap(({ groupIndex, row }) => {
        const variants: ComparisonRow[] = [...(linkedVariantsByGroup.get(groupIndex)?.entries() ?? [])].map(
          ([id, item], index, all) => {
            const derivedVersions = derivedVersionsFor(item.sourceImportIds);
            return {
              id,
              label: `${l.importedPrompt}${all.length > 1 ? ` ${index + 1}` : ''} · V${String(item.version.versionNo).padStart(2, '0')}`,
              version: derivedVersions.at(-1) ?? null,
              baseVersionId: item.version.id,
              versionIds: derivedVersions.map((version) => version.id),
              changeSummary: '',
              prompt: item.prompt,
              previousPrompt: item.baselinePrompt,
              fullPrompt: item.prompt,
              termNames: comparisonVersionReferenceNames(item.version, locale, terms, wordPalettes),
              runs: [
                ...item.runs,
                ...derivedVersions
                  .flatMap((version) => version.runs)
                  .filter((run) => run.outputDisposition !== 'FAILED'),
              ],
            };
          },
        );
        return [...variants, row];
      });
    const standaloneRows: ComparisonRow[] = [...standaloneByPrompt.entries()].map(([promptKey, item], index, all) => {
      const derivedVersions = derivedVersionsFor(item.sourceImportIds);
      return {
        id: comparisonImportedPromptRowId(promptKey),
        label: all.length > 1 ? `${l.importedPrompt} ${index + 1}` : l.importedPrompt,
        version: derivedVersions.at(-1) ?? null,
        baseVersionId: null,
        versionIds: derivedVersions.map((version) => version.id),
        changeSummary: '',
        prompt: item.prompt,
        previousPrompt: '',
        fullPrompt: item.prompt,
        termNames: [],
        runs: [
          ...item.runs,
          ...derivedVersions.flatMap((version) => version.runs).filter((run) => run.outputDisposition !== 'FAILED'),
        ],
      };
    });
    const unboundRow: ComparisonRow[] = unbound.length
      ? [
          {
            id: '__imported',
            label: l.imported,
            version: null,
            baseVersionId: null,
            versionIds: [],
            changeSummary: '',
            prompt: '',
            previousPrompt: '',
            fullPrompt: '',
            termNames: [],
            runs: unbound,
          },
        ]
      : [];
    return [...standaloneRows, ...unboundRow, ...promptRows];
  }, [importedOutputs, l.imported, l.importedPrompt, locale, terms, versions, wordPalettes]);
  const sourceImportIdByRunId = useMemo(
    () => new Map<string, string>(importedOutputs.map((output) => [`import:${output.id}`, output.id])),
    [importedOutputs],
  );
  const [explicitModelKeys, setExplicitModelKeys] = useState<string[]>([]);
  const successfulAndActiveModelKeys = useMemo(
    () =>
      collectVisibleComparisonModelKeys(
        rows.flatMap((row) => row.runs),
        tasks.filter((task) => task.seriesId === series.id).map((task) => task.modelKey),
        [],
      ),
    [rows, series.id, tasks],
  );
  const visibleModelKeys = useMemo(
    () => collectVisibleComparisonModelKeys([], successfulAndActiveModelKeys, explicitModelKeys),
    [explicitModelKeys, successfulAndActiveModelKeys],
  );
  const modelColumns = useMemo(() => {
    const byKey = new Map(
      filterKnownComparisonModels(routes, new Set(visibleModelKeys)).map((model) => [model.key, model]),
    );
    for (const output of importedOutputs) {
      const key = importedColumnKey(output);
      if (byKey.has(key)) continue;
      const name =
        key === actualColumnKey
          ? l.notAiGenerated
          : key === unknownColumnKey
            ? l.unknown
            : output.modelName || importedExecutionRouteKey(output) || l.unknown;
      byKey.set(key, {
        key,
        name,
        provider: key === actualColumnKey || key === unknownColumnKey ? '' : output.modelProvider,
        providerKey: '',
        modelId: output.modelVersion || key,
        state: 'UNAVAILABLE',
        availabilityReason: 'IMPORTED',
        releaseStage: 'STABLE',
        internal: false,
        maxReferenceImages: null,
        capabilities: [],
        qualityMode: 'PROVIDER_MANAGED',
        supportedQualities: [],
      });
    }
    for (const key of visibleModelKeys) {
      if (!byKey.has(key))
        byKey.set(key, {
          key,
          name: key,
          provider: '',
          providerKey: '',
          modelId: key,
          state: 'UNAVAILABLE',
          availabilityReason: 'HISTORICAL',
          releaseStage: 'STABLE',
          internal: false,
          maxReferenceImages: null,
          capabilities: [],
          qualityMode: 'PROVIDER_MANAGED',
          supportedQualities: [],
        });
    }
    return [...byKey.values()];
  }, [importedOutputs, l.notAiGenerated, l.unknown, routes, visibleModelKeys]);
  const addableModels = useMemo(() => {
    const automatic = new Set(successfulAndActiveModelKeys);
    return routes.filter((model) => model.capabilities.includes('GENERATE') && !automatic.has(model.key));
  }, [routes, successfulAndActiveModelKeys]);
  const [axisMode, setAxisMode] = useState<AxisMode>('MODEL');
  const [promptDisplayMode, setPromptDisplayMode] = useState<PromptDisplayMode>('DIFF');
  const [anchorModelKey, setAnchorModelKey] = useState(() => modelColumns[0]?.key ?? '');
  const [busyCells, setBusyCells] = useState<Set<string>>(() => new Set());
  const [pairSelecting, setPairSelecting] = useState(false);
  const [activePairSlot, setActivePairSlot] = useState<PairSlot>('A');
  const [pairRunIds, setPairRunIds] = useState<Record<PairSlot, string | null>>({ A: null, B: null });
  const [pairOpen, setPairOpen] = useState(false);
  const [focusedCell, setFocusedCell] = useState<VirtualGridCell | null>(null);

  const runsByRowAndModel = useMemo(
    () =>
      new Map(
        rows.map((row) => {
          const byModel = new Map<string, GenerationRunDto[]>();
          for (const run of row.runs) byModel.set(run.modelKey, [...(byModel.get(run.modelKey) ?? []), run]);
          for (const [modelKey, runs] of byModel) byModel.set(modelKey, chronological(runs));
          return [row.id, byModel] as const;
        }),
      ),
    [rows],
  );
  const activeTasksByRowAndModel = useMemo(() => {
    const tasksByVersion = new Map<string, GenerationTaskDto[]>();
    for (const task of tasks) {
      if (task.seriesId !== series.id) continue;
      tasksByVersion.set(task.versionId, [...(tasksByVersion.get(task.versionId) ?? []), task]);
    }
    return new Map(
      rows.map((row) => {
        const byModel = new Map<string, GenerationTaskDto[]>();
        for (const task of row.versionIds.flatMap((versionId) => tasksByVersion.get(versionId) ?? [])) {
          byModel.set(task.modelKey, [...(byModel.get(task.modelKey) ?? []), task]);
        }
        return [row.id, byModel] as const;
      }),
    );
  }, [rows, series.id, tasks]);
  const runsFor = (rowId: string, modelKey: string) => runsByRowAndModel.get(rowId)?.get(modelKey) ?? [];

  const pairItems = useMemo(
    () =>
      rows.flatMap((row) =>
        modelColumns.flatMap((model) => {
          const runs = runsByRowAndModel.get(row.id)?.get(model.key) ?? [];
          return runs.flatMap((run, index): PairComparisonItem[] =>
            run.asset
              ? [
                  {
                    id: run.id,
                    mediaUrl: run.asset.mediaUrl,
                    width: run.asset.width,
                    height: run.asset.height,
                    promptLabel: row.label,
                    modelLabel: modelLabel(model),
                    repeatLabel: `R${index + 1}`,
                  },
                ]
              : [],
          );
        }),
      ),
    [modelColumns, rows, runsByRowAndModel, messages.creator.generationTargets.internalLibraryRandom],
  );
  const pairItemByRunId = useMemo(() => new Map(pairItems.map((item) => [item.id, item])), [pairItems]);
  const pairA = pairRunIds.A ? pairItemByRunId.get(pairRunIds.A) : undefined;
  const pairB = pairRunIds.B ? pairItemByRunId.get(pairRunIds.B) : undefined;

  useEffect(() => {
    if (!modelColumns.some((model) => model.key === anchorModelKey)) setAnchorModelKey(modelColumns[0]?.key ?? '');
    if (axisMode === 'REPEAT' && modelColumns.length === 0) setAxisMode('MODEL');
  }, [anchorModelKey, axisMode, modelColumns]);

  useEffect(() => {
    if (!pairOpen || (pairA && pairB)) return;
    closePairComparison();
  }, [onFullWindowChange, pairA, pairB, pairOpen]);

  useEffect(() => {
    onFullWindowChange(false);
    setPairSelecting(false);
    setActivePairSlot('A');
    setPairRunIds({ A: null, B: null });
    setPairOpen(false);
    setExplicitModelKeys([]);
    setAxisMode('MODEL');
    setFocusedCell(null);
    pairMatrixAnchor.current = null;
    expandedBeforePair.current = false;
  }, [series.id, onFullWindowChange]);

  useEffect(() => {
    if (!fullWindow && !pairOpen && !pairSelecting) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      if (pairOpen) {
        closePairComparison();
        return;
      }
      if (pairSelecting) {
        setPairSelecting(false);
        requestAnimationFrame(() => pairButtonRef.current?.focus());
        return;
      }
      const gridFocusWillRestore = changeFullWindow(false);
      if (!gridFocusWillRestore) requestAnimationFrame(() => fullWindowButtonRef.current?.focus());
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullWindow, onFullWindowChange, pairOpen, pairSelecting]);

  function changeFullWindow(open: boolean) {
    const anchor = matrixScrollRef.current?.captureAnchor();
    onFullWindowChange(open);
    requestAnimationFrame(() => {
      if (anchor) matrixScrollRef.current?.restoreAnchor(anchor);
    });
    return Boolean(anchor?.hadFocus);
  }

  function enterPairComparison() {
    expandedBeforePair.current = fullWindow;
    pairMatrixAnchor.current = matrixScrollRef.current?.captureAnchor() ?? null;
    onFullWindowChange(true);
    setPairOpen(true);
  }

  function openPairComparison() {
    if (!pairA || !pairB) return;
    enterPairComparison();
  }

  function closePairComparison() {
    const anchor = pairMatrixAnchor.current;
    pairMatrixAnchor.current = null;
    setPairOpen(false);
    onFullWindowChange(expandedBeforePair.current);
    requestAnimationFrame(() => {
      if (anchor) matrixScrollRef.current?.restoreAnchor(anchor);
      if (!anchor?.hadFocus) pairButtonRef.current?.focus();
    });
  }

  function choosePairResult(runId: string) {
    const otherSlot: PairSlot = activePairSlot === 'A' ? 'B' : 'A';
    const next = { ...pairRunIds, [activePairSlot]: runId };
    if (next[otherSlot] === runId) next[otherSlot] = pairRunIds[activePairSlot];
    setPairRunIds(next);
    setActivePairSlot(otherSlot);
    if (next.A && next.B) {
      enterPairComparison();
    }
  }

  function pairSlotFor(runId: string): PairSlot | null {
    if (pairRunIds.A === runId) return 'A';
    if (pairRunIds.B === runId) return 'B';
    return null;
  }

  function togglePairSelection() {
    if (pairA && pairB) {
      openPairComparison();
      return;
    }
    setPairSelecting((current) => !current);
    setActivePairSlot(pairA ? 'B' : 'A');
  }

  async function generate(row: ComparisonRow, modelKey: string) {
    const cellKey = `${row.id}:${modelKey}`;
    if (busyCells.has(cellKey)) return;
    setBusyCells((current) => new Set(current).add(cellKey));
    try {
      const sourceRun =
        chronological(row.runs.filter((run) => run.modelKey === modelKey)).at(-1) ?? chronological(row.runs).at(-1);
      const model = modelColumns.find((candidate) => candidate.key === modelKey);
      const settings = comparisonGenerationSettings(sourceRun, model);
      if (row.version) {
        await onGenerate({ versionId: row.version.id, modelKey, ...settings });
      } else if (row.fullPrompt.trim()) {
        const sourceImportId = sourceRun ? sourceImportIdByRunId.get(sourceRun.id) : undefined;
        if (!sourceImportId) return;
        const prompt = row.fullPrompt.trim();
        await onGeneratePrompt({
          seriesId: series.id,
          creationDraftId: null,
          baseVersionId: row.baseVersionId,
          sourceImportId,
          title: series.title,
          titleLocale: locale,
          manualPrompt: prompt,
          prompt,
          changeSummary: l.importedPrompt,
          referenceAssetIds: [],
          termPromptLocale: locale,
          termIds: [],
          wordPaletteReferences: [],
          modelKey,
          ...settings,
        });
      }
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyCells((current) => {
        const next = new Set(current);
        next.delete(cellKey);
        return next;
      });
    }
  }

  async function retry(row: ComparisonRow, run: GenerationRunDto) {
    const cellKey = `${row.id}:${run.modelKey}`;
    if (busyCells.has(cellKey)) return;
    setBusyCells((current) => new Set(current).add(cellKey));
    try {
      await onRetry(run.id);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyCells((current) => {
        const next = new Set(current);
        next.delete(cellKey);
        return next;
      });
    }
  }

  const anchorModel = modelColumns.find((model) => model.key === anchorModelKey);
  const anchorCanGenerate = Boolean(anchorModel?.state === 'READY' && anchorModel.capabilities.includes('GENERATE'));
  const repeatColumnCount = Math.max(
    1,
    ...rows.map(
      (row) =>
        runsFor(row.id, anchorModelKey).length + ((row.version || row.fullPrompt.trim()) && anchorCanGenerate ? 1 : 0),
    ),
  );
  const matrixColumns = useMemo<ComparisonColumn[]>(
    () =>
      axisMode === 'MODEL'
        ? modelColumns.map((model) => ({ kind: 'MODEL', key: `model:${model.key}`, model }))
        : Array.from({ length: repeatColumnCount }, (_, repeatIndex) => ({
            kind: 'REPEAT',
            key: `repeat:${repeatIndex + 1}`,
            repeatIndex,
          })),
    [axisMode, modelColumns, repeatColumnCount],
  );

  useEffect(() => {
    if (!rows.length || !matrixColumns.length) {
      setFocusedCell(null);
      return;
    }
    setFocusedCell((current) => {
      const rowKey = current && rows.some((row) => row.id === current.rowKey) ? current.rowKey : rows[0].id;
      const currentColumn =
        current && matrixColumns.some((column) => column.key === current.columnKey) ? current.columnKey : null;
      const anchorColumn =
        axisMode === 'MODEL' && matrixColumns.some((column) => column.key === `model:${anchorModelKey}`)
          ? `model:${anchorModelKey}`
          : matrixColumns[0].key;
      const next = { rowKey, columnKey: currentColumn ?? anchorColumn };
      return current?.rowKey === next.rowKey && current.columnKey === next.columnKey ? current : next;
    });
  }, [anchorModelKey, axisMode, matrixColumns, rows]);

  function comparisonCellLabel(row: ComparisonRow, column: ComparisonColumn) {
    const modelKey = column.kind === 'MODEL' ? column.model.key : anchorModelKey;
    const runs = runsFor(row.id, modelKey);
    const active = activeTasksByRowAndModel.get(row.id)?.get(modelKey) ?? [];
    const parts = [row.label, column.kind === 'MODEL' ? modelLabel(column.model) : `R${column.repeatIndex + 1}`];

    if (column.kind === 'MODEL') {
      const successes = runs.filter((item) => item.asset);
      const failure = [...runs].reverse().find((item) => ['FAILED', 'INTERRUPTED'].includes(item.status));
      if (active.length > 0 || runs.some((item) => ['QUEUED', 'RUNNING'].includes(item.status)))
        parts.push(l.generating);
      if (successes.length > 0) parts.push(`${runs.length} ${l.runs}`, `${successes.length} ${l.images}`);
      else if (failure) parts.push(generationErrorPresentation(failure, messages).summary);
      else if (runs.some((item) => item.status === 'CANCELLED')) parts.push(l.cancelled);
      else if (
        (row.version || row.fullPrompt.trim()) &&
        column.model.state === 'READY' &&
        column.model.capabilities.includes('GENERATE')
      )
        parts.push(l.generate);
      return parts.join(' · ');
    }

    const run = runs[column.repeatIndex];
    if (run?.asset) parts.push(`1 ${l.images}`);
    else if (run && ['QUEUED', 'RUNNING'].includes(run.status)) parts.push(l.generating);
    else if (run && ['FAILED', 'INTERRUPTED'].includes(run.status))
      parts.push(generationErrorPresentation(run, messages).summary);
    else if (run?.status === 'CANCELLED') parts.push(l.cancelled);
    else if (!run && column.repeatIndex === runs.length && active.length > 0) parts.push(l.generating);
    else if (!run && column.repeatIndex === runs.length && (row.version || row.fullPrompt.trim()) && anchorCanGenerate)
      parts.push(l.generate);
    return parts.join(' · ');
  }

  return (
    <FullWindowComparison expanded={fullWindow}>
      {pairOpen && pairA && pairB && (
        <PairComparisonView
          a={pairA}
          b={pairB}
          labels={{
            sideBySide: l.sideBySide,
            swipe: l.swipe,
            swipePosition: l.swipePosition,
            toggle: l.toggle,
            overlay: l.overlay,
            swap: l.swap,
            zoomOut: l.zoomOut,
            fit: l.fit,
            zoomIn: l.zoomIn,
            close: l.backToMatrix,
            opacity: l.opacity,
            a: l.pairA,
            b: l.pairB,
          }}
          onSwap={() => setPairRunIds({ A: pairRunIds.B, B: pairRunIds.A })}
          onClose={closePairComparison}
        />
      )}
      <div className={cn('flex min-h-0 flex-1 flex-col', pairOpen && 'hidden')}>
        <div data-comparison-toolbar className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <Segmented
            type="single"
            value={axisMode}
            onValueChange={(value) => value && setAxisMode(value as AxisMode)}
            className="h-10"
          >
            <SegmentedItem value="MODEL" className="h-9">
              {l.model}
            </SegmentedItem>
            <SegmentedItem value="REPEAT" className="h-9" disabled={modelColumns.length === 0}>
              {l.repeat}
            </SegmentedItem>
          </Segmented>
          {axisMode === 'REPEAT' && (
            <Select value={anchorModelKey} onValueChange={setAnchorModelKey}>
              <SelectTrigger className="h-9 w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {modelColumns.map((model) => (
                  <SelectItem key={model.key} value={model.key}>
                    {modelLabel(model)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <ComparisonModelPicker
            routes={addableModels}
            selectedModelKeys={explicitModelKeys}
            onSelectedModelKeysChange={setExplicitModelKeys}
          />
          <div className="h-4 w-px shrink-0 bg-border" />
          <span className="shrink-0 text-[11px] text-muted-foreground">{l.prompt}</span>
          <Segmented
            type="single"
            value={promptDisplayMode}
            onValueChange={(value) => value && setPromptDisplayMode(value as PromptDisplayMode)}
            className="h-10"
          >
            <SegmentedItem value="PROMPT" className="h-9 px-2.5">
              {l.promptText}
            </SegmentedItem>
            <SegmentedItem value="DIFF" className="h-9 px-2.5">
              {l.promptDiff}
            </SegmentedItem>
          </Segmented>
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-0.5">
            {(pairSelecting || pairRunIds.A || pairRunIds.B) && (
              <>
                <Button
                  type="button"
                  variant={activePairSlot === 'A' ? 'secondary' : 'ghost'}
                  size="icon"
                  aria-label={l.pairA}
                  aria-pressed={activePairSlot === 'A'}
                  onClick={() => {
                    setPairSelecting(true);
                    setActivePairSlot('A');
                  }}
                >
                  {l.pairA}
                </Button>
                <Button
                  type="button"
                  variant={activePairSlot === 'B' ? 'secondary' : 'ghost'}
                  size="icon"
                  aria-label={l.pairB}
                  aria-pressed={activePairSlot === 'B'}
                  onClick={() => {
                    setPairSelecting(true);
                    setActivePairSlot('B');
                  }}
                >
                  {l.pairB}
                </Button>
              </>
            )}
            <Button
              ref={pairButtonRef}
              type="button"
              variant={pairSelecting ? 'secondary' : 'ghost'}
              size="sm"
              className="min-h-9"
              disabled={pairItems.length < 2}
              aria-label={l.pair}
              aria-pressed={pairSelecting}
              title={l.pair}
              onClick={togglePairSelection}
            >
              <Columns2Icon className="size-3.5" />
              {l.pair}
            </Button>
            <Button
              ref={fullWindowButtonRef}
              type="button"
              variant={fullWindow ? 'secondary' : 'ghost'}
              size="sm"
              className="min-h-9"
              aria-label={fullWindow ? l.exitFullWindow : l.fullWindow}
              title={fullWindow ? l.exitFullWindow : l.fullWindow}
              onClick={() => changeFullWindow(!fullWindow)}
            >
              {fullWindow ? <Minimize2Icon className="size-3.5" /> : <Maximize2Icon className="size-3.5" />}
              {fullWindow ? l.exitFullWindow : l.fullWindow}
            </Button>
          </div>
        </div>
        <VirtualGrid
          ref={matrixScrollRef}
          rows={rows}
          columns={matrixColumns}
          getRowKey={(row) => row.id}
          getColumnKey={(column) => column.key}
          rowHeight={248}
          columnWidth={axisMode === 'MODEL' ? 288 : 256}
          rowHeaderWidth={320}
          headerHeight={48}
          overscan={1}
          ariaLabel={l.matrix}
          cornerHeader={l.prompt}
          activeCell={focusedCell}
          onActiveCellChange={setFocusedCell}
          onActivateCell={(row, column) => {
            const runs = runsFor(row.id, column.kind === 'MODEL' ? column.model.key : anchorModelKey);
            const run = column.kind === 'MODEL' ? runs.filter((item) => item.asset).at(-1) : runs[column.repeatIndex];
            if (run?.asset) onSelectAsset(run.asset.id);
          }}
          getCellLabel={comparisonCellLabel}
          className="min-h-0 flex-1 text-xs"
          columnHeaderClassName="text-left"
          cellClassName="p-2 align-top"
          renderColumnHeader={(column) =>
            column.kind === 'MODEL' ? (
              <ComparisonModelHeader
                model={column.model}
                name={modelLabel(column.model)}
                previewLabel={messages.creator.generationTargets.preview}
                unavailableLabel={messages.creator.generationTargets.unavailable}
              />
            ) : (
              <span className="font-mono tabular-nums">R{column.repeatIndex + 1}</span>
            )
          }
          renderRowHeader={(row) => (
            <ComparisonPromptCell
              label={row.label}
              changeSummary={row.changeSummary}
              prompt={row.prompt}
              previousPrompt={row.previousPrompt}
              fullPrompt={row.fullPrompt}
              termNames={row.termNames}
              mode={promptDisplayMode}
              labels={{
                prompt: l.prompt,
                added: l.added,
                removed: l.removed,
                usedTerms: l.usedTerms,
                copyFullPrompt: l.copyFullPrompt,
                promptCopied: l.promptCopied,
                promptEmpty: l.promptEmpty,
                promptUnchanged: l.promptUnchanged,
              }}
            />
          )}
          renderCell={(row, column) => {
            if (column.kind === 'MODEL') {
              const model = column.model;
              const runs = runsFor(row.id, model.key);
              const successes = runs.filter((run) => run.asset);
              const active = activeTasksByRowAndModel.get(row.id)?.get(model.key) ?? [];
              const cellKey = `${row.id}:${model.key}`;
              const busy = busyCells.has(cellKey);
              const generatable = Boolean(
                (row.version || row.fullPrompt.trim()) && model.capabilities.includes('GENERATE'),
              );
              const pending = active.length > 0 || runs.some((run) => ['QUEUED', 'RUNNING'].includes(run.status));
              const failure = [...runs].reverse().find((run) => ['FAILED', 'INTERRUPTED'].includes(run.status));
              const activeLabel = active[0]
                ? generationPhaseLabel(active[0], messages.app.generationStatus)
                : l.generating;
              return (
                <div className="flex size-full min-h-0 flex-col">
                  {successes.length > 0 && (
                    <ComparisonResultStack
                      runs={runs}
                      seriesId={series.id}
                      pairSelecting={pairSelecting}
                      contextLabel={`${row.label} · ${modelLabel(model)}`}
                      labels={{ images: l.images, viewAllImages: l.viewAllImages }}
                      pairSlotFor={pairSlotFor}
                      onSelect={onSelectAsset}
                      onPairSelect={choosePairResult}
                      notify={notify}
                    />
                  )}
                  {successes.length === 0 &&
                    (pending ? (
                      <div className="flex min-h-48 flex-1 items-center justify-center">
                        <StatusDot variant="pending" label={activeLabel} labelVisibility="visible" />
                      </div>
                    ) : failure ? (
                      <GenerationFailureState
                        run={failure}
                        retryLabel={
                          failure.status === 'INTERRUPTED'
                            ? messages.app.generationStatus.regenerate
                            : messages.app.generationStatus.retry
                        }
                        editLabel={messages.app.generationStatus.reEdit}
                        disabled={busy || model.state !== 'READY'}
                        onEdit={() => onReEdit(failure.id)}
                        onRetry={() => void retry(row, failure)}
                      />
                    ) : generatable ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-48 flex-1 rounded-none"
                        disabled={busy || model.state !== 'READY'}
                        aria-busy={busy}
                        onClick={() => void generate(row, model.key)}
                      >
                        {busy ? <CircleIcon className="size-3.5 fill-current" /> : <PlusIcon className="size-4" />}
                        {busy ? l.generating : l.generate}
                      </Button>
                    ) : (
                      <div className="flex min-h-48 flex-1 items-center justify-center text-muted-foreground">—</div>
                    ))}
                  <div className="flex min-h-8 items-center gap-2 border-t px-2 py-1.5">
                    {active.length > 0 && <StatusDot variant="pending" label={activeLabel} labelVisibility="visible" />}
                    <span className="min-w-0 flex-1 text-muted-foreground">
                      <span className="font-mono tabular-nums">{runs.length}</span> {l.runs} ·{' '}
                      <span className="font-mono tabular-nums">{successes.length}</span> {l.images}
                    </span>
                    {generatable && runs.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2"
                        disabled={busy || model.state !== 'READY'}
                        aria-busy={busy}
                        onClick={() => void generate(row, model.key)}
                      >
                        {busy ? <CircleIcon className="size-3 fill-current" /> : <PlusIcon className="size-3" />}
                        {busy ? l.generating : l.regenerate}
                      </Button>
                    )}
                  </div>
                </div>
              );
            }

            const index = column.repeatIndex;
            const runs = runsFor(row.id, anchorModelKey);
            const run = runs[index];
            const isNext = Boolean(row.version || row.fullPrompt.trim()) && index === runs.length;
            const model = anchorModel;
            const busy = busyCells.has(`${row.id}:${anchorModelKey}`);
            const generatable = Boolean((row.version || row.fullPrompt.trim()) && anchorCanGenerate);
            return (
              <div className="flex size-full min-h-0 flex-col">
                {run?.asset && (
                  <ComparisonResultStack
                    runs={[run]}
                    seriesId={series.id}
                    repeatOrdinalOffset={index}
                    pairSelecting={pairSelecting}
                    contextLabel={`${row.label} · ${model ? modelLabel(model) : ''}`}
                    labels={{ images: l.images, viewAllImages: l.viewAllImages }}
                    pairSlotFor={pairSlotFor}
                    onSelect={onSelectAsset}
                    onPairSelect={choosePairResult}
                    notify={notify}
                  />
                )}
                {run && ['FAILED', 'INTERRUPTED'].includes(run.status) && (
                  <GenerationFailureState
                    run={run}
                    retryLabel={
                      run.status === 'INTERRUPTED'
                        ? messages.app.generationStatus.regenerate
                        : messages.app.generationStatus.retry
                    }
                    editLabel={messages.app.generationStatus.reEdit}
                    disabled={busy || model?.state !== 'READY'}
                    onEdit={() => onReEdit(run.id)}
                    onRetry={() => void retry(row, run)}
                  />
                )}
                {run && !run.asset && ['QUEUED', 'RUNNING'].includes(run.status) && (
                  <div className="flex min-h-48 flex-1 items-center justify-center">
                    <StatusDot variant="pending" label={l.generating} labelVisibility="visible" />
                  </div>
                )}
                {run && !run.asset && !['FAILED', 'INTERRUPTED', 'QUEUED', 'RUNNING'].includes(run.status) && (
                  <div className="flex min-h-48 flex-1 items-center justify-center text-muted-foreground">—</div>
                )}
                {!run && isNext && generatable && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-56 flex-1 rounded-none"
                    disabled={busy || model?.state !== 'READY'}
                    aria-busy={busy}
                    onClick={() => void generate(row, anchorModelKey)}
                  >
                    {busy ? <CircleIcon className="size-3.5 fill-current" /> : <PlusIcon className="size-4" />}
                    {busy ? l.generating : l.generate}
                  </Button>
                )}
                {!run && (!isNext || !generatable) && (
                  <div className="flex min-h-56 flex-1 items-center justify-center text-muted-foreground">—</div>
                )}
                {run && (
                  <div className="flex min-h-8 items-center border-t px-2 py-1.5 text-muted-foreground">
                    {run.asset ? (
                      <>
                        <span className="font-mono tabular-nums">1</span>&nbsp;{l.images}
                      </>
                    ) : (
                      run.status
                    )}
                  </div>
                )}
              </div>
            );
          }}
        />
      </div>
    </FullWindowComparison>
  );
}
