import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  CropIcon,
  FlaskConicalIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  PackageOpenIcon,
  PanelRightCloseIcon,
  RotateCcwIcon,
  UploadIcon,
} from 'lucide-react';
import type {
  AnnotationDto,
  AnnotationStatus,
  AssetFileRevealContext,
  AssetDto,
  ImageEditBatchStartInput,
  ImageCropInput,
  ImageReframeStartInput,
  ImageTransformOutputDto,
  ImportedCreationOutputDto,
  ImageGenerationRouteDto,
  GenerationInput,
  GenerationTargetInput,
  GenerationTaskDto,
  GenerationVersionInput,
  Locale,
  PromptSeriesDto,
  TermListItem,
  WordPaletteDto,
} from '@/shared/contracts';
import { CloseIcon, ImageIcon } from '@/renderer/icons';
import { useI18n } from '@/renderer/i18n/useI18n';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Badge } from '@/renderer/components/ui/badge';
import { HoverRevealButton } from '@/renderer/components/ui/hover-reveal-button';
import { Segmented, SegmentedItem } from '@/renderer/components/ui/segmented';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { AnnotationComposer } from '@/renderer/components/creator/annotations/AnnotationComposer';
import { AnnotationList } from '@/renderer/components/creator/annotations/AnnotationList';
import { AnnotationToolbar } from '@/renderer/components/creator/annotations/AnnotationToolbar';
import type { AnnotationMode, BrushMode, PendingAnnotation } from '@/renderer/components/creator/annotations/types';
import {
  AnnotationImageStage,
  type AnnotationImageStageHandle,
} from '@/renderer/components/creator/annotations/annotorious/AnnotationImageStage';
import { GenerationComparison } from '@/renderer/components/creator/GenerationComparison';
import { CreatorPaneResizeHandle } from '@/renderer/components/creator/CreatorPaneResizeHandle';
import { OutputGenerationRecord } from '@/renderer/components/creator/OutputGenerationRecord';
import { OutputThumbnailRail } from '@/renderer/components/creator/OutputThumbnailRail';
import { allAssets } from '@/renderer/components/creator/utils';
import { isEditableTarget, type RendererImageImportSource } from '@/renderer/components/creator/imageImport';
import { PasteDropSurface } from '@/renderer/components/creator/intake/PasteDropSurface';
import type { AnnotationRefinementState } from '@/renderer/components/creator/annotationRefinement';
import type { CreationExperimentContext } from '@/renderer/components/creator/creationExperimentContext';
import type { CreationOutputVersionGroup } from '@/renderer/components/creator/creationOutputProjection';
import { OutputVersionStrip } from '@/renderer/components/creator/OutputVersionStrip';
import {
  ImageEditConfirmDialog,
  type ImageEditConfirmValue,
} from '@/renderer/components/creator/ImageEditConfirmDialog';
import { ImageAspectDialog, type ImageAspectRatio } from '@/renderer/components/creator/ImageAspectDialog';

interface Props {
  headerNavigation: ReactNode;
  series: PromptSeriesDto | undefined;
  primarySeries?: PromptSeriesDto;
  outputProjection?: CreationOutputVersionGroup[];
  locale: Locale;
  terms: TermListItem[];
  wordPalettes: WordPaletteDto[];
  imageGenerationRoutes: ImageGenerationRouteDto[];
  generationTargets: GenerationTargetInput[];
  generationTasks: GenerationTaskDto[];
  requestedAssetId: string | null;
  annotationWorkspaceRequest: { assetId: string; requestId: number } | null;
  onAnnotationRefinementStateChange(state: AnnotationRefinementState | null): void;
  onRequestedAssetIdChange(assetId: string, mode?: 'push' | 'replace'): void;
  galleryOpen: boolean;
  collapsed: boolean;
  comparisonFullWindow: boolean;
  onCollapsedChange(collapsed: boolean): void;
  onResizeStart(event: ReactPointerEvent<HTMLDivElement>): void;
  resizeValue: number;
  resizeMin: number;
  resizeMax: number;
  onResizeValueChange(value: number): void;
  onComparisonFullWindowChange(open: boolean): void;
  onGalleryOpenChange(open: boolean): void;
  onGenerateVersion(input: GenerationVersionInput): Promise<void>;
  onGeneratePrompt(input: GenerationInput): Promise<void>;
  onReusePrompt(
    seriesId: string,
    versionId: string,
    annotationHistoryVersionId: string | null,
  ): Promise<{ annotationsReused: boolean } | null>;
  onRefineImage(input: Omit<ImageEditBatchStartInput, 'locale'>): Promise<void>;
  onCropImage(input: ImageCropInput): Promise<ImageTransformOutputDto>;
  onReframeImage(input: Omit<ImageReframeStartInput, 'locale' | 'quality'>): Promise<void>;
  onRetryGeneration(runId: string): Promise<void>;
  onReEditGeneration(runId: string): void;
  distilling: boolean;
  onDistillKnowledge(assetId: string): void | Promise<void>;
  importing: boolean;
  onImportFiles(files: File[], source: RendererImageImportSource, sourceUrl?: string): void;
  onChooseImport(): void;
  onPasteText(text: string): void;
  onImportedOutputUpdated(): Promise<void>;
  onImportedOutputSaved(output: ImportedCreationOutputDto): void;
  notify(message: string): void;
}

interface OutputAssetRecord {
  asset: AssetDto;
  ownerSeries: PromptSeriesDto;
  experimentContext: CreationExperimentContext | null;
  projected: boolean;
  failed: boolean;
}

function promptVersionForAsset(series: PromptSeriesDto, assetId: string) {
  const visited = new Set<string>();
  let candidateAssetId: string | null = assetId;
  while (candidateAssetId && !visited.has(candidateAssetId)) {
    visited.add(candidateAssetId);
    const generated = series.versions.find((version) => version.runs.some((run) => run.asset?.id === candidateAssetId));
    if (generated) return generated;
    const imported = series.importedOutputs?.find((output) => output.imageAssetId === candidateAssetId);
    if (imported?.promptVersionId) {
      return series.versions.find((version) => version.id === imported.promptVersionId) ?? null;
    }
    candidateAssetId =
      series.transformedOutputs?.find((output) => output.asset.id === candidateAssetId)?.sourceAssetId ?? null;
  }
  return null;
}

function pendingFromAnnotation(annotation: AnnotationDto): PendingAnnotation {
  return {
    type: annotation.type,
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height,
    geometry: annotation.geometry,
  };
}

export function OutputInspector({
  headerNavigation,
  series,
  primarySeries,
  outputProjection = [],
  locale,
  terms,
  wordPalettes,
  imageGenerationRoutes,
  generationTargets,
  generationTasks,
  requestedAssetId,
  annotationWorkspaceRequest,
  onAnnotationRefinementStateChange,
  onRequestedAssetIdChange,
  galleryOpen,
  collapsed,
  comparisonFullWindow,
  onCollapsedChange,
  onResizeStart,
  resizeValue,
  resizeMin,
  resizeMax,
  onResizeValueChange,
  onComparisonFullWindowChange,
  onGalleryOpenChange,
  onGenerateVersion,
  onGeneratePrompt,
  onReusePrompt,
  onRefineImage,
  onCropImage,
  onReframeImage,
  onRetryGeneration,
  onReEditGeneration,
  distilling,
  onDistillKnowledge,
  importing,
  onImportFiles,
  onChooseImport,
  onPasteText,
  onImportedOutputUpdated,
  onImportedOutputSaved,
  notify,
}: Props) {
  const { messages } = useI18n();
  const labels = messages.creator.annotations;
  const gallery = messages.creator.inspector;
  const inspectorSeries = primarySeries ?? series;
  const assetRecords = useMemo(() => {
    const records: OutputAssetRecord[] = [];
    const recordIndexByAssetId = new Map<string, number>();
    const append = (record: OutputAssetRecord) => {
      const existingIndex = recordIndexByAssetId.get(record.asset.id);
      if (existingIndex !== undefined) {
        if (records[existingIndex].failed && !record.failed) records[existingIndex] = record;
        return;
      }
      recordIndexByAssetId.set(record.asset.id, records.length);
      records.push(record);
    };
    for (const group of outputProjection) {
      if (inspectorSeries) {
        for (const item of group.primaryAssets)
          append({
            asset: item.asset,
            ownerSeries: inspectorSeries,
            experimentContext: null,
            projected: true,
            failed: false,
          });
        for (const item of group.failedPrimaryAssets)
          append({
            asset: item.asset,
            ownerSeries: inspectorSeries,
            experimentContext: null,
            projected: true,
            failed: true,
          });
      }
      for (const stack of group.directionStacks) {
        if (!stack.series) continue;
        const experimentContext: CreationExperimentContext = {
          batch: stack.batch,
          slot: stack.slot,
          sourceSeries: inspectorSeries ?? null,
          sourceVersion: group.version,
          directionNo: stack.directionNo,
          directionCount: group.directionStacks.length,
          versionLabel: stack.versionLabel,
        };
        for (const item of stack.assets)
          append({
            asset: item.asset,
            ownerSeries: stack.series,
            experimentContext,
            projected: true,
            failed: false,
          });
        for (const item of stack.failedAssets)
          append({
            asset: item.asset,
            ownerSeries: stack.series,
            experimentContext,
            projected: true,
            failed: true,
          });
      }
    }
    const relatedSeries = [
      ...(inspectorSeries ? [inspectorSeries] : []),
      ...(series && series.id !== inspectorSeries?.id ? [series] : []),
      ...outputProjection.flatMap((group) => group.directionStacks.flatMap((stack) => stack.series ?? [])),
    ].filter((item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index);
    for (const ownerSeries of relatedSeries) {
      for (const asset of allAssets(ownerSeries))
        append({
          asset,
          ownerSeries,
          experimentContext: null,
          projected: false,
          failed: false,
        });
    }
    return records;
  }, [inspectorSeries, outputProjection, series]);
  const visibleAssetRecords = useMemo(() => assetRecords.filter((record) => !record.failed), [assetRecords]);
  const assets = useMemo(() => visibleAssetRecords.map((record) => record.asset), [visibleAssetRecords]);
  const newestAssetId =
    visibleAssetRecords.find((record) => record.ownerSeries.id === series?.id)?.asset.id ?? assets[0]?.id ?? null;
  const [assetId, setAssetId] = useState<string | null>(newestAssetId);
  const previousSeriesId = useRef(series?.id);
  const appliedRequestedAssetId = useRef<string | null>(null);
  const assetRecord = assetRecords.find((item) => item.asset.id === assetId) ?? visibleAssetRecords[0] ?? null;
  const asset = assetRecord?.asset ?? null;
  const experimentContext = assetRecord?.experimentContext ?? null;
  const assetOwnerSeries = assetRecord?.ownerSeries ?? series;
  const ungroupedAssets = visibleAssetRecords.filter((record) => !record.projected).map((record) => record.asset);
  const ownerSeriesIdByAssetId = useMemo(
    () => new Map(assetRecords.map((record) => [record.asset.id, record.ownerSeries.id])),
    [assetRecords],
  );
  const revealContextForAsset = useCallback(
    (nextAssetId: string): AssetFileRevealContext | undefined => {
      const ownerSeriesId = ownerSeriesIdByAssetId.get(nextAssetId);
      return ownerSeriesId ? { kind: 'CREATION', seriesId: ownerSeriesId } : undefined;
    },
    [ownerSeriesIdByAssetId],
  );
  const annotationViewerRef = useRef<AnnotationImageStageHandle>(null);
  const appliedAnnotationWorkspaceRequest = useRef<string | null>(null);
  const [annotationWorkspaceOpen, setAnnotationWorkspaceOpen] = useState(false);
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>('view');
  const [brushMode, setBrushMode] = useState<BrushMode>('ADD');
  const [brushRadius, setBrushRadius] = useState(0.03);
  const [annotations, setAnnotations] = useState<AnnotationDto[]>([]);
  const [pendingAnnotation, setPendingAnnotation] = useState<PendingAnnotation | null>(null);
  const [annotationText, setAnnotationText] = useState('');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [markersVisible, setMarkersVisible] = useState(true);
  const [showHistory, setShowHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refinementDialogOpen, setRefinementDialogOpen] = useState(false);
  const [refinementError, setRefinementError] = useState('');
  const [aspectDialogOpen, setAspectDialogOpen] = useState(false);
  const [transforming, setTransforming] = useState(false);
  const [reusingPrompt, setReusingPrompt] = useState(false);
  const [busyAnnotationId, setBusyAnnotationId] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<'preview' | 'comparison'>('preview');

  const numberedAnnotations = useMemo(
    () => annotations.map((annotation, index) => ({ annotation, number: index + 1 })),
    [annotations],
  );
  const displayedAnnotations = useMemo(
    () =>
      showHistory ? numberedAnnotations : numberedAnnotations.filter(({ annotation }) => annotation.status === 'OPEN'),
    [numberedAnnotations, showHistory],
  );
  const stageAnnotations = useMemo(
    () =>
      editingAnnotationId
        ? displayedAnnotations.filter(({ annotation }) => annotation.id !== editingAnnotationId)
        : displayedAnnotations,
    [displayedAnnotations, editingAnnotationId],
  );
  const actionableNumberedAnnotations = useMemo(
    () =>
      numberedAnnotations.filter(
        ({ annotation }) => annotation.status === 'OPEN' && Boolean(annotation.comment.trim()),
      ),
    [numberedAnnotations],
  );
  const actionableAnnotations = useMemo(
    () => actionableNumberedAnnotations.map(({ annotation }) => annotation),
    [actionableNumberedAnnotations],
  );
  const visibleRefinementAnnotations = useMemo(
    () =>
      actionableNumberedAnnotations.map(({ annotation, number }) => ({
        id: annotation.id,
        number,
        comment: annotation.comment.trim(),
      })),
    [actionableNumberedAnnotations],
  );
  const annotationRefinementSourceAssetId = annotationWorkspaceOpen ? (asset?.id ?? null) : null;
  const annotationRefinementSourceSeriesId = annotationWorkspaceOpen ? (assetOwnerSeries?.id ?? null) : null;

  useEffect(() => {
    onAnnotationRefinementStateChange(
      annotationRefinementSourceAssetId && annotationRefinementSourceSeriesId && visibleRefinementAnnotations.length
        ? {
            sourceAssetId: annotationRefinementSourceAssetId,
            sourceSeriesId: annotationRefinementSourceSeriesId,
            annotations: visibleRefinementAnnotations,
          }
        : null,
    );
  }, [
    annotationRefinementSourceAssetId,
    annotationRefinementSourceSeriesId,
    onAnnotationRefinementStateChange,
    visibleRefinementAnnotations,
  ]);

  useEffect(
    () => () => {
      onAnnotationRefinementStateChange(null);
    },
    [onAnnotationRefinementStateChange],
  );
  const refinementModels = useMemo(
    () => imageGenerationRoutes.filter((model) => model.state === 'READY' && model.capabilities.includes('IMAGE_EDIT')),
    [imageGenerationRoutes],
  );
  const reframeModel = useMemo(() => {
    const byKey = new Map(refinementModels.map((model) => [model.key, model]));
    return generationTargets.flatMap((target) => byKey.get(target.modelKey) ?? [])[0] ?? refinementModels[0] ?? null;
  }, [generationTargets, refinementModels]);
  const sourceVersion = useMemo(() => {
    if (!asset || !assetOwnerSeries) return null;
    return promptVersionForAsset(assetOwnerSeries, asset.id);
  }, [asset, assetOwnerSeries]);
  const reuseVersion =
    sourceVersion?.sourceImageId && assetOwnerSeries
      ? (promptVersionForAsset(assetOwnerSeries, sourceVersion.sourceImageId) ??
        assetOwnerSeries.versions.find((version) => version.id === sourceVersion.parentVersionId) ??
        sourceVersion)
      : sourceVersion;
  const reuseAnnotationHistoryVersionId = sourceVersion?.sourceImageId ? sourceVersion.id : null;
  const supportingReferenceCount =
    sourceVersion?.referenceAssets.filter((reference) => reference.id !== asset?.id).length ?? 0;

  useEffect(() => {
    const seriesChanged = previousSeriesId.current !== series?.id;
    previousSeriesId.current = series?.id;
    setAssetId((current) =>
      seriesChanged || !current || !assets.some((item) => item.id === current) ? newestAssetId : current,
    );
    if (!seriesChanged) return;
    setAnnotationWorkspaceOpen(false);
    setAspectDialogOpen(false);
    setAnnotationMode('view');
    setBrushMode('ADD');
    setPendingAnnotation(null);
    setAnnotationText('');
    setSelectedAnnotationId(null);
    setEditingAnnotationId(null);
    setMarkersVisible(true);
    setShowHistory(false);
    setRefinementDialogOpen(false);
    setRefinementError('');
  }, [assets, newestAssetId, series?.id]);

  useEffect(() => {
    if (!requestedAssetId) {
      appliedRequestedAssetId.current = null;
      setAssetId(newestAssetId);
      setDisplayMode('preview');
      setAnnotationWorkspaceOpen(false);
      onComparisonFullWindowChange(false);
      return;
    }
    if (appliedRequestedAssetId.current === requestedAssetId) return;
    if (!assets.some((item) => item.id === requestedAssetId)) return;
    appliedRequestedAssetId.current = requestedAssetId;
    setAssetId(requestedAssetId);
    setDisplayMode('preview');
    setAnnotationWorkspaceOpen(false);
    onComparisonFullWindowChange(false);
  }, [requestedAssetId, assets, newestAssetId, onComparisonFullWindowChange]);

  const selectAsset = useCallback(
    (nextAssetId: string, mode: 'push' | 'replace' = 'push') => {
      setAssetId(nextAssetId);
      if (nextAssetId !== requestedAssetId) onRequestedAssetIdChange(nextAssetId, mode);
    },
    [onRequestedAssetIdChange, requestedAssetId],
  );

  useEffect(() => {
    if (!inspectorSeries) onComparisonFullWindowChange(false);
  }, [inspectorSeries, onComparisonFullWindowChange]);

  useEffect(() => {
    setPendingAnnotation(null);
    setAnnotationText('');
    setSelectedAnnotationId(null);
    setEditingAnnotationId(null);
    setAnnotationWorkspaceOpen(false);
    setAspectDialogOpen(false);
    setAnnotationMode('view');
    setBrushMode('ADD');
    setShowHistory(false);
    setRefinementDialogOpen(false);
    setRefinementError('');
    if (!asset) {
      setAnnotations([]);
      return undefined;
    }
    let alive = true;
    setAnnotations([]);
    void window.desktopApi
      .annotationsList(asset.id)
      .then((items) => {
        if (alive) setAnnotations(items);
      })
      .catch((reason) => {
        if (alive) notify(String(reason));
      });
    return () => {
      alive = false;
    };
  }, [asset?.id, notify]);

  useEffect(() => {
    if (!annotationWorkspaceRequest || asset?.id !== annotationWorkspaceRequest.assetId) return;
    const requestKey = `${annotationWorkspaceRequest.assetId}:${annotationWorkspaceRequest.requestId}`;
    if (appliedAnnotationWorkspaceRequest.current === requestKey) return;
    appliedAnnotationWorkspaceRequest.current = requestKey;
    setDisplayMode('preview');
    setAnnotationWorkspaceOpen(true);
    setAnnotationMode('view');
    setPendingAnnotation(null);
    setAnnotationText('');
    setEditingAnnotationId(null);
    setSelectedAnnotationId(null);
    setMarkersVisible(true);
    setShowHistory(false);
    onComparisonFullWindowChange(false);
    void window.desktopApi
      .annotationsList(asset.id)
      .then(setAnnotations)
      .catch((reason) => notify(reason instanceof Error ? reason.message : String(reason)));
  }, [annotationWorkspaceRequest, asset?.id, notify, onComparisonFullWindowChange]);

  const changeAnnotationStatus = useCallback(
    async (id: string, status: AnnotationStatus) => {
      if (busyAnnotationId) return;
      setBusyAnnotationId(id);
      try {
        const updated = await window.desktopApi.annotationsSetStatus({ annotationId: id, status });
        setAnnotations((current) => current.map((annotation) => (annotation.id === id ? updated : annotation)));
        if (status !== 'OPEN' && !showHistory) setSelectedAnnotationId(null);
        notify(
          status === 'OPEN'
            ? labels.reopenedNotice
            : status === 'RESOLVED'
              ? labels.resolvedNotice
              : labels.dismissedNotice,
        );
      } catch (reason) {
        notify(`${labels.statusFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
      } finally {
        setBusyAnnotationId(null);
      }
    },
    [busyAnnotationId, labels, notify, showHistory],
  );

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (displayMode !== 'preview') return;
      if (isEditableTarget(event.target)) return;
      if (event.key === 'Escape') {
        if (editingAnnotationId || pendingAnnotation) {
          const editedId = editingAnnotationId;
          setPendingAnnotation(null);
          setAnnotationText('');
          setEditingAnnotationId(null);
          setAnnotationMode('view');
          if (editedId) setSelectedAnnotationId(editedId);
        } else if (selectedAnnotationId) {
          setSelectedAnnotationId(null);
        } else if (annotationWorkspaceOpen && annotationMode === 'view') {
          setAnnotationWorkspaceOpen(false);
        } else {
          setAnnotationMode('view');
        }
        return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedAnnotationId) {
        const selected = annotations.find((annotation) => annotation.id === selectedAnnotationId);
        if (selected?.status === 'OPEN') {
          event.preventDefault();
          void changeAnnotationStatus(selected.id, 'DISMISSED');
        }
      }
    }
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [
    annotationMode,
    annotationWorkspaceOpen,
    annotations,
    changeAnnotationStatus,
    displayMode,
    editingAnnotationId,
    pendingAnnotation,
    selectedAnnotationId,
  ]);

  function changeDisplayMode(nextMode: 'preview' | 'comparison') {
    if (saving || refining) return;
    setDisplayMode(nextMode);
    if (nextMode === 'comparison') {
      setAnnotationWorkspaceOpen(false);
      setAnnotationMode('view');
      setPendingAnnotation(null);
      setAnnotationText('');
      setEditingAnnotationId(null);
      setSelectedAnnotationId(null);
    }
    if (nextMode === 'preview') onComparisonFullWindowChange(false);
  }

  async function saveAnnotation() {
    if (!asset || !pendingAnnotation || saving) return;
    const annotationId = editingAnnotationId;
    setSaving(true);
    try {
      const savedAnnotation = annotationId
        ? await window.desktopApi.annotationsUpdate({
            annotationId,
            ...pendingAnnotation,
            comment: annotationText,
          })
        : await window.desktopApi.annotationsAdd({
            imageAssetId: asset.id,
            ...pendingAnnotation,
            comment: annotationText,
          });
      setAnnotations((current) =>
        annotationId
          ? current.map((annotation) => (annotation.id === annotationId ? savedAnnotation : annotation))
          : [...current, savedAnnotation],
      );
      setPendingAnnotation(null);
      setAnnotationText('');
      setEditingAnnotationId(null);
      setAnnotationMode('view');
      setSelectedAnnotationId(savedAnnotation.id);
      setMarkersVisible(true);
      notify(annotationId ? labels.updated : labels.saved);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      notify(annotationId ? `${labels.updateFailed}: ${message}` : message);
    } finally {
      setSaving(false);
    }
  }

  function cancelAnnotation() {
    const editedId = editingAnnotationId;
    setPendingAnnotation(null);
    setAnnotationText('');
    setEditingAnnotationId(null);
    setAnnotationMode('view');
    if (editedId) setSelectedAnnotationId(editedId);
  }

  function editAnnotation(id: string) {
    const annotation = annotations.find((item) => item.id === id);
    if (!annotation || annotation.status !== 'OPEN' || saving) return;
    setEditingAnnotationId(id);
    setPendingAnnotation(pendingFromAnnotation(annotation));
    setAnnotationText(annotation.comment);
    setSelectedAnnotationId(id);
    setAnnotationMode('view');
    setMarkersVisible(true);
  }

  function redrawAnnotationRange() {
    if (!editingAnnotationId) return;
    const annotation = annotations.find((item) => item.id === editingAnnotationId);
    const type = pendingAnnotation?.type ?? annotation?.type;
    if (!type) return;
    setPendingAnnotation(null);
    setSelectedAnnotationId(null);
    setAnnotationMode(type);
    setBrushMode('ADD');
    setMarkersVisible(true);
  }

  function openAnnotationWorkspace() {
    setAnnotationWorkspaceOpen(true);
    setAnnotationMode('view');
    setMarkersVisible(true);
  }

  function closeAnnotationWorkspace() {
    if (pendingAnnotation || editingAnnotationId || saving || refining) return;
    setAnnotationWorkspaceOpen(false);
    setAnnotationMode('view');
    setSelectedAnnotationId(null);
  }

  function changeMode(mode: AnnotationMode) {
    if (mode === annotationMode) return;
    if (editingAnnotationId) {
      setAnnotationMode(mode);
      if (mode !== 'view') {
        setPendingAnnotation(null);
        setSelectedAnnotationId(null);
        setMarkersVisible(true);
      }
      return;
    }
    setAnnotationMode(mode);
    setPendingAnnotation(null);
    setAnnotationText('');
    setSelectedAnnotationId(null);
    if (mode !== 'view') setMarkersVisible(true);
  }

  function changeHistory(visible: boolean) {
    setShowHistory(visible);
    if (!visible) {
      const selected = annotations.find((annotation) => annotation.id === selectedAnnotationId);
      if (selected?.status !== 'OPEN') setSelectedAnnotationId(null);
    }
  }

  function reviewImageEdit() {
    if (!asset || !assetOwnerSeries || !refinementModels.length || !actionableAnnotations.length) return;
    setRefinementError('');
    setRefinementDialogOpen(true);
  }

  async function reusePrompt() {
    if (!reuseVersion || !assetOwnerSeries || reusingPrompt) return;
    setReusingPrompt(true);
    try {
      const reused = await onReusePrompt(assetOwnerSeries.id, reuseVersion.id, reuseAnnotationHistoryVersionId);
      if (reused) {
        notify(
          reused.annotationsReused
            ? messages.creator.generationRecord.promptAndAnnotationsReused
            : messages.creator.generationRecord.promptReused,
        );
      }
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setReusingPrompt(false);
    }
  }

  async function refineImage(value: ImageEditConfirmValue) {
    if (!asset || !assetOwnerSeries || refining) return;
    setRefining(true);
    setRefinementError('');
    try {
      await onRefineImage({
        seriesId: assetOwnerSeries.id,
        sourceAssetId: asset.id,
        ...value,
      });
      setRefinementDialogOpen(false);
      setAnnotationWorkspaceOpen(false);
      setAnnotationMode('view');
      setSelectedAnnotationId(null);
      notify(labels.refinementStarted);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setRefinementError(message);
      notify(`${labels.refinementFailed}: ${message}`);
    } finally {
      setRefining(false);
    }
  }

  async function cropImage(ratio: ImageAspectRatio) {
    if (!asset || !assetOwnerSeries || transforming) return;
    setTransforming(true);
    try {
      const output = await onCropImage({
        seriesId: assetOwnerSeries.id,
        sourceAssetId: asset.id,
        ratioWidth: ratio.width,
        ratioHeight: ratio.height,
      });
      selectAsset(output.asset.id);
      setAspectDialogOpen(false);
      notify(messages.creator.imageTransform.cropCompleted);
    } catch (reason) {
      notify(
        `${messages.creator.imageTransform.cropFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      setTransforming(false);
    }
  }

  async function reframeImage(ratio: ImageAspectRatio) {
    if (!asset || !assetOwnerSeries || !reframeModel || transforming) return;
    setTransforming(true);
    try {
      await onReframeImage({
        seriesId: assetOwnerSeries.id,
        sourceAssetId: asset.id,
        modelKey: reframeModel.key,
        ratioWidth: ratio.width,
        ratioHeight: ratio.height,
      });
      setAspectDialogOpen(false);
      notify(messages.creator.imageTransform.reframeStarted);
    } catch (reason) {
      notify(
        `${messages.creator.imageTransform.reframeFailed}: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      setTransforming(false);
    }
  }

  async function setOutputFailed(runId: string, failed: boolean) {
    await window.desktopApi.generationOutputSetFailed({ runId, failed });
    await onImportedOutputUpdated();
    notify(
      failed
        ? locale === 'zh'
          ? '已标记为失败'
          : 'Marked as failed'
        : locale === 'zh'
          ? '已恢复显示'
          : 'Output restored',
    );
  }

  const hasVersionStripContent =
    outputProjection.some(
      (group) =>
        group.primaryAssets.length > 0 ||
        group.failedPrimaryAssets.length > 0 ||
        group.directionStacks.some((stack) => stack.assets.length > 0 || stack.failedAssets.length > 0),
    ) || ungroupedAssets.length > 0;

  const versionStrip = (
    <OutputVersionStrip
      groups={outputProjection}
      ungroupedAssets={ungroupedAssets}
      selectedAssetId={asset?.id ?? null}
      locale={locale}
      onSelect={selectAsset}
      onSetFailed={setOutputFailed}
      notify={notify}
      revealContextForAsset={revealContextForAsset}
    />
  );

  const inspector = (
    <PasteDropSurface
      className="relative flex min-h-0 min-w-0 flex-col bg-muted"
      disabled={importing}
      onImages={onImportFiles}
      onText={onPasteText}
      overlay={<UploadIcon className="size-8 text-muted-foreground" />}
    >
      {!comparisonFullWindow && (
        <CreatorPaneResizeHandle
          edge="left"
          label={gallery.resize}
          value={resizeValue}
          min={resizeMin}
          max={resizeMax}
          onValueChange={onResizeValueChange}
          onPointerDown={onResizeStart}
        />
      )}
      <header
        className={cn(
          'flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border/60 bg-secondary px-3',
          comparisonFullWindow && 'hidden',
        )}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            {headerNavigation}
            {asset && (
              <small className="truncate text-xs text-muted-foreground">
                {asset.width} × {asset.height}
              </small>
            )}
          </div>
          {experimentContext && (
            <div
              className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground"
              title={`${experimentContext.slot.variableAxis}${experimentContext.slot.risk ? ` · ${experimentContext.slot.risk}` : ''}`}
            >
              <Badge variant="secondary" className="h-4 shrink-0 gap-1 rounded-sm px-1.5 py-0 text-[9px] font-medium">
                <FlaskConicalIcon className="size-2.5" />
                {locale === 'zh' ? '方向实验' : 'Experiment'}
              </Badge>
              <span className="shrink-0 font-semibold text-foreground-secondary">{experimentContext.versionLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">{experimentContext.slot.label}</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={importing}
            title={gallery.importResults}
            aria-label={gallery.importResults}
            onClick={onChooseImport}
          >
            {importing ? <LoaderCircleIcon className="size-4 animate-spin" /> : <UploadIcon className="size-4" />}
          </Button>
          {inspectorSeries &&
            (inspectorSeries.versions.length > 0 || (inspectorSeries.importedOutputs?.length ?? 0) > 0) && (
              <Segmented
                type="single"
                value={displayMode}
                onValueChange={(value) => value && changeDisplayMode(value as typeof displayMode)}
                className="h-7"
              >
                <SegmentedItem value="preview" className="h-6 px-2.5">
                  {gallery.preview}
                </SegmentedItem>
                <SegmentedItem data-action="output-comparison" value="comparison" className="h-6 px-2.5">
                  {gallery.comparison}
                </SegmentedItem>
              </Segmented>
            )}
        </div>
      </header>
      {inspectorSeries && (
        <div className={cn('min-h-0 flex-1', displayMode === 'comparison' ? 'flex' : 'hidden')}>
          <GenerationComparison
            series={inspectorSeries}
            locale={locale}
            terms={terms}
            wordPalettes={wordPalettes}
            routes={imageGenerationRoutes}
            tasks={generationTasks}
            fullWindow={comparisonFullWindow}
            onFullWindowChange={onComparisonFullWindowChange}
            onSelectAsset={(nextAssetId) => {
              selectAsset(nextAssetId);
              changeDisplayMode('preview');
            }}
            onGenerate={onGenerateVersion}
            onGeneratePrompt={onGeneratePrompt}
            onRetry={onRetryGeneration}
            onReEdit={onReEditGeneration}
            notify={notify}
          />
        </div>
      )}
      {displayMode !== 'comparison' &&
        (asset ? (
          <>
            <div className="relative min-h-0 flex-1" data-slot="output-inspector-image" data-asset-id={asset.id}>
              <AssetFileContextMenu assetId={asset.id} notify={notify} revealContext={revealContextForAsset(asset.id)}>
                <AnnotationImageStage
                  ref={annotationViewerRef}
                  className="size-full"
                  active={annotationWorkspaceOpen}
                  asset={asset}
                  annotations={stageAnnotations}
                  labels={labels}
                  brushMode={brushMode}
                  brushRadius={brushRadius}
                  markersVisible={annotationWorkspaceOpen && markersVisible}
                  mode={annotationWorkspaceOpen ? annotationMode : 'view'}
                  pending={annotationWorkspaceOpen ? pendingAnnotation : null}
                  selectedId={selectedAnnotationId}
                  onPendingChange={(annotation) => {
                    setPendingAnnotation(annotation);
                    setSelectedAnnotationId(null);
                    setMarkersVisible(true);
                  }}
                  onSelect={setSelectedAnnotationId}
                />
              </AssetFileContextMenu>
              {annotationWorkspaceOpen ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex flex-col items-center gap-2 px-3">
                  {(pendingAnnotation || editingAnnotationId) && (
                    <AnnotationComposer
                      labels={labels}
                      text={annotationText}
                      saving={saving}
                      editing={Boolean(editingAnnotationId)}
                      rangeReady={Boolean(pendingAnnotation)}
                      onTextChange={setAnnotationText}
                      onRedrawRange={redrawAnnotationRange}
                      onCancel={cancelAnnotation}
                      onSave={() => void saveAnnotation()}
                    />
                  )}
                  <AnnotationToolbar
                    labels={labels}
                    mode={annotationMode}
                    brushMode={brushMode}
                    brushRadius={brushRadius}
                    canEraseBrush={pendingAnnotation?.type === 'BRUSH'}
                    markersVisible={markersVisible}
                    hasMarkers={annotations.length > 0 || Boolean(pendingAnnotation)}
                    doneDisabled={Boolean(pendingAnnotation) || Boolean(editingAnnotationId) || saving || refining}
                    onModeChange={changeMode}
                    onBrushModeChange={setBrushMode}
                    onBrushRadiusChange={setBrushRadius}
                    onMarkersVisibleChange={setMarkersVisible}
                    onZoomOut={() => annotationViewerRef.current?.zoomOut()}
                    onFit={() => annotationViewerRef.current?.fit()}
                    onZoomIn={() => annotationViewerRef.current?.zoomIn()}
                    onRefine={reviewImageEdit}
                    refineDisabled={
                      !refinementModels.length ||
                      !actionableAnnotations.length ||
                      Boolean(pendingAnnotation) ||
                      Boolean(editingAnnotationId) ||
                      saving
                    }
                    refineDisabledReason={
                      !refinementModels.length
                        ? labels.refineUnavailable
                        : !actionableAnnotations.length
                          ? labels.refineNeedsComments
                          : undefined
                    }
                    refining={refining}
                    onDone={closeAnnotationWorkspace}
                  />
                </div>
              ) : (
                <div className="absolute right-3 bottom-3 z-20 flex items-center gap-1.5">
                  {reuseVersion && (
                    <HoverRevealButton
                      type="button"
                      data-action="reuse-prompt"
                      variant="secondary"
                      label={messages.creator.generationRecord.reusePrompt}
                      className="shadow-overlay"
                      disabled={reusingPrompt}
                      onClick={() => void reusePrompt()}
                    >
                      {reusingPrompt ? (
                        <LoaderCircleIcon className="size-4 animate-spin" />
                      ) : (
                        <RotateCcwIcon className="size-4" />
                      )}
                    </HoverRevealButton>
                  )}
                  <HoverRevealButton
                    type="button"
                    variant="secondary"
                    label={messages.creator.knowledgeDistillation.title}
                    className="shadow-overlay"
                    disabled={distilling}
                    onClick={() => void onDistillKnowledge(asset.id)}
                  >
                    {distilling ? (
                      <LoaderCircleIcon className="size-4 animate-spin" />
                    ) : (
                      <PackageOpenIcon className="size-4" />
                    )}
                  </HoverRevealButton>
                  <HoverRevealButton
                    type="button"
                    data-action="image-transform-open"
                    variant="secondary"
                    label={messages.creator.imageTransform.title}
                    className="shadow-overlay"
                    onClick={() => setAspectDialogOpen(true)}
                  >
                    <CropIcon className="size-4" />
                  </HoverRevealButton>
                  <HoverRevealButton
                    type="button"
                    variant="secondary"
                    label={`${labels.annotate}${annotations.some((annotation) => annotation.status === 'OPEN') ? ` ${annotations.filter((annotation) => annotation.status === 'OPEN').length}` : ''}`}
                    className="shadow-overlay"
                    onClick={openAnnotationWorkspace}
                  >
                    <MessageSquareIcon className="size-4" />
                  </HoverRevealButton>
                </div>
              )}
              {annotationWorkspaceOpen && !pendingAnnotation && !editingAnnotationId && annotations.length > 0 && (
                <div className="pointer-events-none absolute top-3 right-3 z-20 w-[min(20rem,calc(100%-1.5rem))]">
                  <AnnotationList
                    annotations={numberedAnnotations}
                    busyId={busyAnnotationId}
                    labels={labels}
                    selectedId={selectedAnnotationId}
                    showHistory={showHistory}
                    onHistoryChange={changeHistory}
                    onSelect={(id) => setSelectedAnnotationId((current) => (current === id ? null : id))}
                    onEdit={editAnnotation}
                    onStatusChange={(id, status) => void changeAnnotationStatus(id, status)}
                  />
                </div>
              )}
            </div>
            {!annotationWorkspaceOpen && (
              <>
                <OutputGenerationRecord
                  series={assetOwnerSeries}
                  experimentContext={experimentContext}
                  assetId={asset.id}
                  locale={locale}
                  terms={terms}
                  wordPalettes={wordPalettes}
                  imageGenerationRoutes={imageGenerationRoutes}
                  onImportedOutputSaved={onImportedOutputSaved}
                  notify={notify}
                />
                {galleryOpen ? (
                  <div className="max-h-52 shrink-0 overflow-hidden border-t border-border/60 bg-surface-sunken">
                    <div className="flex h-10 items-center justify-between px-3">
                      <span className="text-xs font-medium">
                        {gallery.all} · {assets.length}
                      </span>
                      <button
                        type="button"
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => onGalleryOpenChange(false)}
                      >
                        {gallery.close}
                        <CloseIcon className="size-3" />
                      </button>
                    </div>
                    <div className="grid max-h-40 grid-cols-[repeat(auto-fill,minmax(54px,1fr))] gap-2 overflow-y-auto pr-3 pb-3 pl-12">
                      {assets.map((item) => (
                        <AssetFileContextMenu
                          key={item.id}
                          assetId={item.id}
                          notify={notify}
                          revealContext={revealContextForAsset(item.id)}
                        >
                          <button
                            type="button"
                            className={cn(
                              'aspect-[3/4] min-w-0 overflow-hidden rounded-md border-2 border-transparent bg-media-surround-light p-0.5 outline-none hover:border-border-strong focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                              item.id === asset.id && 'border-selected-border ring-2 ring-ring',
                            )}
                            onClick={() => {
                              selectAsset(item.id);
                              onGalleryOpenChange(false);
                            }}
                          >
                            <img
                              className="size-full rounded-sm object-contain"
                              src={item.mediaUrl}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              draggable={false}
                            />
                          </button>
                        </AssetFileContextMenu>
                      ))}
                    </div>
                  </div>
                ) : (
                  versionStrip
                )}
              </>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-1 items-center justify-center">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={importing}
                title={gallery.importResults}
                aria-label={gallery.importResults}
                onClick={onChooseImport}
              >
                {importing ? (
                  <LoaderCircleIcon className="size-5 animate-spin" />
                ) : (
                  <ImageIcon className="size-6 opacity-50" />
                )}
              </Button>
            </div>
            {hasVersionStripContent && versionStrip}
          </>
        ))}
      <Button
        type="button"
        variant="secondary"
        size="icon-sm"
        className={cn(
          'absolute bottom-2 left-2 z-30 hidden shadow-overlay min-[840px]:inline-flex',
          comparisonFullWindow && 'min-[840px]:hidden',
        )}
        title={gallery.collapse}
        aria-label={gallery.collapse}
        onClick={() => onCollapsedChange(true)}
      >
        <PanelRightCloseIcon className="size-4" />
      </Button>
      <ImageEditConfirmDialog
        open={refinementDialogOpen}
        locale={locale}
        annotations={actionableAnnotations}
        routes={refinementModels}
        preferredTargets={generationTargets}
        supportingReferenceCount={supportingReferenceCount}
        nativeMaskAvailable={asset?.mimeType === 'image/png'}
        busy={refining}
        error={refinementError}
        onOpenChange={(open) => {
          setRefinementDialogOpen(open);
          if (!open) setRefinementError('');
        }}
        onConfirm={refineImage}
      />
      <ImageAspectDialog
        open={aspectDialogOpen}
        aiAvailable={Boolean(reframeModel)}
        busy={transforming}
        onOpenChange={setAspectDialogOpen}
        onCrop={(ratio) => void cropImage(ratio)}
        onReframe={(ratio) => void reframeImage(ratio)}
      />
    </PasteDropSurface>
  );

  if (collapsed && !comparisonFullWindow)
    return (
      <>
        <div className="hidden size-full min-h-0 min-[840px]:block">
          <OutputThumbnailRail
            assets={assets}
            selectedAssetId={asset?.id ?? null}
            label={gallery.all}
            expandLabel={gallery.expand}
            resizeLabel={gallery.resize}
            resizeValue={resizeValue}
            resizeMin={resizeMin}
            resizeMax={resizeMax}
            onResizeValueChange={onResizeValueChange}
            importLabel={gallery.importResults}
            importing={importing}
            onExpand={() => onCollapsedChange(false)}
            onImport={onChooseImport}
            onResizeStart={onResizeStart}
            onSelect={(nextAssetId) => {
              selectAsset(nextAssetId);
              setDisplayMode('preview');
            }}
            notify={notify}
            revealContextForAsset={revealContextForAsset}
            thumbnailLabel={(_asset, index) => `${gallery.preview} ${index + 1}`}
          />
        </div>
        <div className="size-full min-h-0 min-[840px]:hidden">{inspector}</div>
      </>
    );

  return inspector;
}
