import { ClipboardCopyIcon, ImagePlusIcon, LoaderCircleIcon, ScanSearchIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type {
  ImageBreakdownDto,
  ImageBreakdownPromptKind,
  ImageBreakdownResult,
  ImageBreakdownRouteDto,
  Locale,
} from '@/shared/contracts';
import { imageImportItems, type RendererImageImportSource } from '@/renderer/components/creator/imageImport';
import { PasteDropSurface } from '@/renderer/components/creator/intake/PasteDropSurface';
import { AssetFileContextMenu } from '@/renderer/components/media/AssetFileContextMenu';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/renderer/components/ui/tabs';
import { Textarea } from '@/renderer/components/ui/textarea';
import { CreationWorkNavigation } from '@/renderer/components/creator/CreationWorkNavigation';

interface Props {
  breakdown: ImageBreakdownDto;
  routes: readonly ImageBreakdownRouteDto[];
  locale: Locale;
  refresh(): Promise<void>;
  onOpenSeries(seriesId: string): void;
  notify(message: string): void;
}

const facetKeys = ['subject', 'scene', 'composition', 'lightAndColor', 'style'] as const;

function labels(locale: Locale) {
  return locale === 'zh'
    ? {
        title: '拆解图片',
        analyze: '分析',
        analyzing: '分析中',
        loading: '加载中',
        focus: '分析重点',
        focusPlaceholder: '可选：人物服装、镜头语言、材质、光线…',
        visible: '可见',
        inferred: '推断',
        full: '完整描述',
        style: '仅风格',
        compositionLight: '构图与光线',
        copy: '复制',
        copied: '提示词已复制',
        copyFailed: '复制提示词失败',
        create: '基于提示词创作',
        replaceFailed: '替换图片失败',
        runFailed: '图片拆解失败',
        createFailed: '新建图片创作失败',
        draft: '待分析',
        running: '分析中',
        succeeded: '已完成',
        failed: '失败',
        facets: {
          subject: '主体',
          scene: '场景',
          composition: '构图',
          lightAndColor: '光色',
          style: '风格',
        },
      }
    : {
        title: 'Image breakdown',
        analyze: 'Analyze',
        analyzing: 'Analyzing',
        loading: 'Loading',
        focus: 'Analysis focus',
        focusPlaceholder: 'Optional: wardrobe, camera language, material, lighting…',
        visible: 'Observed',
        inferred: 'Inferred',
        full: 'Full description',
        style: 'Style only',
        compositionLight: 'Composition & light',
        copy: 'Copy',
        copied: 'Prompt copied',
        copyFailed: 'Could not copy prompt',
        create: 'Create from prompt',
        replaceFailed: 'Could not replace image',
        runFailed: 'Image breakdown failed',
        createFailed: 'Could not create image form',
        draft: 'Ready',
        running: 'Analyzing',
        succeeded: 'Complete',
        failed: 'Failed',
        facets: {
          subject: 'Subject',
          scene: 'Scene',
          composition: 'Composition',
          lightAndColor: 'Light & color',
          style: 'Style',
        },
      };
}

function preferredRouteId(routes: readonly ImageBreakdownRouteDto[], breakdown: ImageBreakdownDto) {
  const persisted = routes.find(
    (route) =>
      route.key === breakdown.routeKey && (breakdown.modelKey === null || route.modelKey === breakdown.modelKey),
  );
  if (persisted?.state === 'READY') return persisted.id;
  return routes.find((route) => route.state === 'READY')?.id ?? persisted?.id ?? routes[0]?.id ?? '';
}

function useImageBreakdownRoutes(routes: readonly ImageBreakdownRouteDto[], breakdown: ImageBreakdownDto) {
  const [availableRoutes, setAvailableRoutes] = useState<ImageBreakdownRouteDto[]>(() => [...routes]);
  const [routeId, setRouteId] = useState(() => preferredRouteId(routes, breakdown));
  const [loading, setLoading] = useState(() => !routes.some((route) => route.state === 'READY'));
  useEffect(() => {
    let active = true;
    void window.desktopApi
      .imageBreakdownRoutes()
      .then((next) => {
        if (active) setAvailableRoutes(next);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    setRouteId((current) => {
      const selected = availableRoutes.find((candidate) => candidate.id === current);
      return selected?.state === 'READY' ? current : preferredRouteId(availableRoutes, breakdown);
    });
  }, [availableRoutes, breakdown]);
  return { availableRoutes, loading, routeId, setRouteId };
}

function promptText(breakdown: ImageBreakdownDto, kind: ImageBreakdownPromptKind) {
  if (!breakdown.result) return '';
  if (kind === 'STYLE') return breakdown.result.prompts.style;
  if (kind === 'COMPOSITION_LIGHT') return breakdown.result.prompts.compositionLight;
  return breakdown.result.prompts.full;
}

function BreakdownFacet({
  facet,
  inferredLabel,
  title,
  visibleLabel,
}: {
  facet: ImageBreakdownResult['facets']['subject'];
  inferredLabel: string;
  title: string;
  visibleLabel: string;
}) {
  return (
    <section className="border-t pt-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {facet.observations.length > 0 && (
        <div className="mt-2">
          <span className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
            {visibleLabel}
          </span>
          <ul className="mt-1 grid gap-1 text-sm leading-5">
            {facet.observations.map((item, index) => (
              <li key={`${index}:${item}`}>· {item}</li>
            ))}
          </ul>
        </div>
      )}
      {facet.inferences.length > 0 && (
        <div className="mt-2 text-muted-foreground">
          <span className="text-[0.6875rem] font-medium tracking-wide uppercase">{inferredLabel}</span>
          <ul className="mt-1 grid gap-1 text-sm leading-5">
            {facet.inferences.map((item, index) => (
              <li key={`${index}:${item}`}>· {item}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function ImageBreakdownWorkspace({ breakdown, routes, locale, refresh, onOpenSeries, notify }: Props) {
  const copy = labels(locale);
  const [focus, setFocus] = useState(breakdown.focus);
  const { availableRoutes, loading: routesLoading, routeId, setRouteId } = useImageBreakdownRoutes(routes, breakdown);
  const [busy, setBusy] = useState<'replace' | 'run' | 'create' | ''>('');
  const [promptKind, setPromptKind] = useState<ImageBreakdownPromptKind>('FULL');
  const route = availableRoutes.find((candidate) => candidate.id === routeId) ?? null;
  const selectedPrompt = promptText(breakdown, promptKind);
  const statusLabel = {
    DRAFT: copy.draft,
    RUNNING: copy.running,
    SUCCEEDED: copy.succeeded,
    FAILED: copy.failed,
  }[breakdown.status];
  const promptTabs = useMemo(
    () =>
      [
        { key: 'FULL' as const, label: copy.full },
        { key: 'STYLE' as const, label: copy.style },
        { key: 'COMPOSITION_LIGHT' as const, label: copy.compositionLight },
      ] as const,
    [copy.compositionLight, copy.full, copy.style],
  );

  async function replaceImage(files: File[], source: RendererImageImportSource, sourceUrl: string) {
    if (!files[0] || busy) return;
    setBusy('replace');
    try {
      const items = await imageImportItems([files[0]]);
      const assets = await window.desktopApi.creatorReferencesImport({
        context: {
          seriesId: null,
          versionId: null,
          title: breakdown.title,
          titleLocale: locale,
          source,
          sourceUrl,
        },
        items,
      });
      const sourceAsset = assets[0];
      if (!sourceAsset) throw new Error('Imported image is unavailable');
      await window.desktopApi.imageBreakdownReplaceSource({ id: breakdown.id, sourceAssetId: sourceAsset.id });
      await refresh();
    } catch (reason) {
      notify(`${copy.replaceFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy('');
    }
  }

  async function analyze() {
    if (busy || route?.state !== 'READY') return;
    setBusy('run');
    try {
      await window.desktopApi.imageBreakdownRun({
        id: breakdown.id,
        focus,
        routeKey: route.key,
        modelKey: route.modelKey,
        locale,
      });
    } catch (reason) {
      notify(`${copy.runFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      await refresh().catch(() => undefined);
      setBusy('');
    }
  }

  async function createImageForm() {
    if (!selectedPrompt || busy) return;
    setBusy('create');
    try {
      const result = await window.desktopApi.imageBreakdownCreateImageForm({
        id: breakdown.id,
        promptKind,
        locale,
      });
      await refresh();
      onOpenSeries(result.seriesId);
    } catch (reason) {
      notify(`${copy.createFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy('');
    }
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(selectedPrompt);
      notify(copy.copied);
    } catch (reason) {
      notify(`${copy.copyFailed}: ${reason instanceof Error ? reason.message : String(reason)}`);
    }
  }

  return (
    <PasteDropSurface
      disabled={Boolean(busy)}
      onImages={(files, source, sourceUrl) => void replaceImage(files, source, sourceUrl)}
      overlay={<ImagePlusIcon className="size-8 text-muted-foreground" />}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <ScanSearchIcon className="size-4" />
        <h2 className="min-w-0 truncate text-sm font-semibold">{copy.title}</h2>
        <Badge variant="outline" className={breakdown.status === 'FAILED' ? 'text-destructive' : undefined}>
          {statusLabel}
        </Badge>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <CreationWorkNavigation />
          <Select value={routeId} onValueChange={setRouteId}>
            <SelectTrigger className="w-52" aria-label={copy.title}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableRoutes.map((candidate) => (
                <SelectItem
                  key={candidate.id}
                  value={candidate.id}
                  disabled={candidate.state !== 'READY'}
                  title={candidate.availabilityReason ?? undefined}
                >
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            aria-busy={routesLoading || busy === 'run'}
            disabled={Boolean(busy) || routesLoading || route?.state !== 'READY'}
            title={routesLoading ? copy.loading : (route?.availabilityReason ?? undefined)}
            onClick={() => void analyze()}
          >
            {busy === 'run' || routesLoading ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <ScanSearchIcon className="size-4" />
            )}
            {busy === 'run' ? copy.analyzing : routesLoading ? copy.loading : copy.analyze}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(16rem,0.8fr)_minmax(0,1.2fr)]">
        <div className="flex min-h-0 flex-col border-b lg:border-r lg:border-b-0">
          <div className="grid min-h-48 flex-1 place-items-center overflow-hidden bg-surface-sunken p-4">
            <AssetFileContextMenu assetId={breakdown.sourceAsset.id} notify={notify}>
              <img
                src={breakdown.sourceAsset.mediaUrl}
                alt={breakdown.title}
                className="max-h-full max-w-full rounded-sm object-contain"
              />
            </AssetFileContextMenu>
          </div>
          <div className="shrink-0 border-t p-4">
            <label className="mb-2 block text-xs font-medium" htmlFor={`image-breakdown-focus-${breakdown.id}`}>
              {copy.focus}
            </label>
            <Textarea
              id={`image-breakdown-focus-${breakdown.id}`}
              value={focus}
              maxLength={2_000}
              disabled={Boolean(busy)}
              placeholder={copy.focusPlaceholder}
              className="min-h-20 resize-none"
              onChange={(event) => setFocus(event.target.value)}
            />
          </div>
        </div>

        <ScrollArea className="min-h-0">
          <div className="mx-auto grid max-w-4xl gap-6 p-5">
            {breakdown.result ? (
              <>
                <p className="text-sm leading-6">{breakdown.result.summary}</p>
                <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
                  {facetKeys.map((key) => (
                    <BreakdownFacet
                      key={key}
                      facet={breakdown.result!.facets[key]}
                      inferredLabel={copy.inferred}
                      title={copy.facets[key]}
                      visibleLabel={copy.visible}
                    />
                  ))}
                </div>

                <Tabs value={promptKind} onValueChange={(value) => setPromptKind(value as ImageBreakdownPromptKind)}>
                  <TabsList>
                    {promptTabs.map((tab) => (
                      <TabsTrigger key={tab.key} value={tab.key}>
                        {tab.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {promptTabs.map((tab) => (
                    <TabsContent key={tab.key} value={tab.key} className="pt-3">
                      <Textarea readOnly value={promptText(breakdown, tab.key)} className="min-h-36 resize-none" />
                    </TabsContent>
                  ))}
                  <div className="mt-3 flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!selectedPrompt}
                      onClick={() => void copyPrompt()}
                    >
                      <ClipboardCopyIcon className="size-4" />
                      {copy.copy}
                    </Button>
                    <Button
                      type="button"
                      disabled={Boolean(busy) || !selectedPrompt}
                      onClick={() => void createImageForm()}
                    >
                      {busy === 'create' ? (
                        <LoaderCircleIcon className="size-4 animate-spin" />
                      ) : (
                        <ImagePlusIcon className="size-4" />
                      )}
                      {copy.create}
                    </Button>
                  </div>
                </Tabs>
              </>
            ) : (
              <div className="grid min-h-72 place-items-center text-muted-foreground">
                {breakdown.status === 'RUNNING' ? (
                  <LoaderCircleIcon className="size-7 animate-spin" />
                ) : (
                  <ScanSearchIcon className="size-7" />
                )}
              </div>
            )}
            {breakdown.errorMessage && <p className="text-xs text-destructive">{breakdown.errorMessage}</p>}
          </div>
        </ScrollArea>
      </div>
    </PasteDropSurface>
  );
}
