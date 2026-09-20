import { ArchiveIcon, RotateCcwIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  AssetDto,
  CanvasPresetDto,
  CreationDictionaryScopeDto,
  CreationInputSnapshotDto,
  CreationInputStashDto,
  ImageGenerationRouteDto,
  GenerationTargetInput,
  Locale,
  PromptSeriesDto,
  PromptVersionDto,
  TermListItem,
  WordPaletteDto,
  WordPaletteReferenceInput,
} from '@/shared/contracts';
import { resolveTermTitle } from '@/shared/term-localization';
import { resolveLocalizedName } from '@/shared/word-palette-localization';
import { cn } from '@/renderer/lib/utils';
import { Button } from '@/renderer/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/renderer/components/ui/dialog';
import { ScrollArea } from '@/renderer/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/renderer/components/ui/select';
import { AssetThumbnail } from '@/renderer/components/media/AssetThumbnail';
import { useI18n } from '@/renderer/i18n/useI18n';

interface Props {
  open: boolean;
  locale: Locale;
  current: CreationInputSnapshotDto;
  stashes: CreationInputStashDto[];
  series?: PromptSeriesDto;
  terms: TermListItem[];
  wordPalettes: WordPaletteDto[];
  canvasPresets: CanvasPresetDto[];
  imageGenerationRoutes: ImageGenerationRouteDto[];
  busy: boolean;
  onOpenChange(open: boolean): void;
  onCreate(): Promise<void>;
  onRestore(stash: CreationInputStashDto): void;
}

interface ComparableSnapshot {
  title: string;
  manualPrompt: string;
  resolvedPrompt: string;
  referenceAssetIds: string[];
  referenceAssets: AssetDto[];
  termPromptLocale: Locale;
  termIds: string[];
  wordPaletteReferences: WordPaletteReferenceInput[];
  dictionaryScope: CreationDictionaryScopeDto | null;
  canvasPresetKey: string | null;
  generationTargets: GenerationTargetInput[];
}

interface Candidate {
  id: string;
  label: string;
  snapshot: ComparableSnapshot;
  stash?: CreationInputStashDto;
}

interface ComparisonRow {
  key: string;
  label: string;
  left: ReactNode;
  right: ReactNode;
  changed: boolean;
}

function versionTargets(version: PromptVersionDto): GenerationTargetInput[] {
  const targets = new Map<string, GenerationTargetInput>();
  for (const run of version.runs) {
    const key = `${run.modelKey}\u0000${run.quality}`;
    const existing = targets.get(key);
    if (existing) existing.count += 1;
    else targets.set(key, { modelKey: run.modelKey, quality: run.quality, count: 1 });
  }
  return [...targets.values()];
}

function versionSnapshot(series: PromptSeriesDto, version: PromptVersionDto): ComparableSnapshot {
  return {
    title: series.title,
    manualPrompt: version.manualPrompt,
    resolvedPrompt: version.finalPrompt,
    referenceAssetIds: version.referenceAssets.map((asset) => asset.id),
    referenceAssets: version.referenceAssets,
    termPromptLocale: version.termPromptLocale,
    termIds: version.termIds,
    wordPaletteReferences: version.wordPaletteReferences,
    dictionaryScope: null,
    canvasPresetKey: version.runs[0]?.canvasPresetKey ?? null,
    generationTargets: versionTargets(version),
  };
}

function normalized(value: unknown) {
  return JSON.stringify(value);
}

function textValue(value: string) {
  return <span className="whitespace-pre-wrap break-words">{value || '—'}</span>;
}

function referenceValue(snapshot: ComparableSnapshot, unavailableLabel: string) {
  if (!snapshot.referenceAssetIds.length) return <span>—</span>;
  const byId = new Map(snapshot.referenceAssets.map((asset) => [asset.id, asset]));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {snapshot.referenceAssetIds.map((id, index) => {
        const asset = byId.get(id);
        return asset ? (
          <span key={`${id}:${index}`} className="relative isolate block size-10 overflow-hidden rounded border">
            <AssetThumbnail asset={asset} size={96} ambient className="size-full object-contain" />
          </span>
        ) : (
          <span key={`${id}:${index}`} className="rounded border px-1.5 py-1 text-2xs text-muted-foreground">
            {unavailableLabel}
          </span>
        );
      })}
    </div>
  );
}

export function CreationInputStashDialog({
  open,
  locale,
  current,
  stashes,
  series,
  terms,
  wordPalettes,
  canvasPresets,
  imageGenerationRoutes,
  busy,
  onOpenChange,
  onCreate,
  onRestore,
}: Props) {
  const { messages } = useI18n();
  const zh = locale === 'zh';
  const candidates = useMemo<Candidate[]>(
    () => [
      { id: 'CURRENT', label: zh ? '当前输入' : 'Current input', snapshot: current },
      ...stashes.map((stash) => ({
        id: `STASH:${stash.id}`,
        label: `${zh ? '暂存' : 'Stash'} S${String(stash.revisionNo).padStart(2, '0')} · ${new Intl.DateTimeFormat(
          zh ? 'zh-CN' : 'en-US',
          {
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          },
        ).format(new Date(stash.createdAt))}`,
        snapshot: stash.snapshot,
        stash,
      })),
      ...(series?.versions ?? []).map((version) => ({
        id: `VERSION:${version.id}`,
        label: `V${String(version.versionNo).padStart(2, '0')} · ${version.changeSummary || (zh ? '正式版本' : 'Version')}`,
        snapshot: versionSnapshot(series!, version),
      })),
    ],
    [current, locale, series, stashes, zh],
  );
  const [leftId, setLeftId] = useState('CURRENT');
  const [rightId, setRightId] = useState('CURRENT');

  useEffect(() => {
    if (!open) return;
    setLeftId(candidates.find((candidate) => candidate.id !== 'CURRENT')?.id ?? 'CURRENT');
    setRightId('CURRENT');
  }, [open, stashes[0]?.id, series?.id]);

  const left = candidates.find((candidate) => candidate.id === leftId) ?? candidates[0];
  const right = candidates.find((candidate) => candidate.id === rightId) ?? candidates[0];
  const termName = (id: string) => {
    const term = terms.find((item) => item.id === id);
    return term ? resolveTermTitle(term, locale) : id;
  };
  const paletteName = (reference: WordPaletteReferenceInput) => {
    const palette = wordPalettes.find((item) => item.id === reference.paletteId);
    const name = palette ? resolveLocalizedName(palette, locale) : reference.paletteId;
    const values = Object.entries(reference.parameterValues)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    return values ? `${name} (${values})` : name;
  };
  const canvasName = (key: string | null) => {
    if (!key) return '—';
    const preset = canvasPresets.find((item) => item.stableKey === key);
    return preset ? `${preset.name} · ${preset.ratio} · ${preset.width}×${preset.height}` : key;
  };
  const targetName = (target: GenerationTargetInput) => {
    const model = imageGenerationRoutes.find((item) => item.key === target.modelKey);
    const quality = messages.creator.quality[target.quality];
    return `${model?.name ?? target.modelKey} × ${target.count} · ${quality}`;
  };
  const scopeName = (scope: CreationDictionaryScopeDto | null) =>
    scope === null
      ? '—'
      : scope.mode === 'ALL'
        ? zh
          ? '全部词典'
          : 'All dictionaries'
        : `${zh ? '指定词典' : 'Selected dictionaries'} · ${scope.sources.length}${scope.includeLocalTerms ? ` · ${zh ? '本地' : 'Local'}` : ''}`;

  const rows: ComparisonRow[] = [
    {
      key: 'title',
      label: zh ? '标题' : 'Title',
      left: textValue(left.snapshot.title),
      right: textValue(right.snapshot.title),
      changed: left.snapshot.title !== right.snapshot.title,
    },
    {
      key: 'manual',
      label: 'Prompt',
      left: textValue(left.snapshot.manualPrompt),
      right: textValue(right.snapshot.manualPrompt),
      changed: left.snapshot.manualPrompt !== right.snapshot.manualPrompt,
    },
    {
      key: 'resolved',
      label: zh ? '合成 Prompt' : 'Resolved Prompt',
      left: textValue(left.snapshot.resolvedPrompt),
      right: textValue(right.snapshot.resolvedPrompt),
      changed: left.snapshot.resolvedPrompt !== right.snapshot.resolvedPrompt,
    },
    {
      key: 'terms',
      label: zh ? '词条' : 'Terms',
      left: textValue(left.snapshot.termIds.map(termName).join('\n')),
      right: textValue(right.snapshot.termIds.map(termName).join('\n')),
      changed:
        normalized(left.snapshot.termIds) !== normalized(right.snapshot.termIds) ||
        left.snapshot.termPromptLocale !== right.snapshot.termPromptLocale,
    },
    {
      key: 'palettes',
      label: zh ? '配方' : 'Recipes',
      left: textValue(left.snapshot.wordPaletteReferences.map(paletteName).join('\n')),
      right: textValue(right.snapshot.wordPaletteReferences.map(paletteName).join('\n')),
      changed: normalized(left.snapshot.wordPaletteReferences) !== normalized(right.snapshot.wordPaletteReferences),
    },
    {
      key: 'references',
      label: zh ? '参考图' : 'References',
      left: referenceValue(left.snapshot, messages.contentEditor.imageUnavailable),
      right: referenceValue(right.snapshot, messages.contentEditor.imageUnavailable),
      changed: normalized(left.snapshot.referenceAssetIds) !== normalized(right.snapshot.referenceAssetIds),
    },
    {
      key: 'scope',
      label: zh ? '词典范围' : 'Dictionary scope',
      left: textValue(scopeName(left.snapshot.dictionaryScope)),
      right: textValue(scopeName(right.snapshot.dictionaryScope)),
      changed: normalized(left.snapshot.dictionaryScope) !== normalized(right.snapshot.dictionaryScope),
    },
    {
      key: 'canvas',
      label: zh ? '画幅' : 'Canvas',
      left: textValue(canvasName(left.snapshot.canvasPresetKey)),
      right: textValue(canvasName(right.snapshot.canvasPresetKey)),
      changed: left.snapshot.canvasPresetKey !== right.snapshot.canvasPresetKey,
    },
    {
      key: 'targets',
      label: zh ? '模型与质量' : 'Models & quality',
      left: textValue(left.snapshot.generationTargets.map(targetName).join('\n')),
      right: textValue(right.snapshot.generationTargets.map(targetName).join('\n')),
      changed: normalized(left.snapshot.generationTargets) !== normalized(right.snapshot.generationTargets),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(780px,calc(100vh-2rem))] max-w-5xl grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4 pr-14">
          <DialogTitle>{zh ? '输入暂存与版本对比' : 'Input stashes & version comparison'}</DialogTitle>
          <DialogDescription className="sr-only">
            {zh ? '对比当前输入、暂存和正式版本' : 'Compare current input, stashes and formal versions'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b bg-surface-sunken/25 px-5 py-3">
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void onCreate()}>
            <ArchiveIcon className="size-3.5" />
            {busy ? (zh ? '暂存中' : 'Saving') : zh ? '暂存当前输入' : 'Stash current'}
          </Button>
          {[
            { candidate: left, value: leftId, setValue: setLeftId },
            { candidate: right, value: rightId, setValue: setRightId },
          ].map((column, index) => (
            <div key={index} className="grid min-w-0 gap-2">
              <Select value={column.value} onValueChange={column.setValue}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-w-md">
                  {candidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {column.candidate.stash && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="justify-self-start"
                  onClick={() => onRestore(column.candidate.stash!)}
                >
                  <RotateCcwIcon className="size-3" />
                  {zh ? '恢复此暂存' : 'Restore this stash'}
                </Button>
              )}
            </div>
          ))}
        </div>

        <ScrollArea className="min-h-0">
          <div className="grid grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)] px-5 py-3 text-xs">
            {rows.map((row) => (
              <div key={row.key} className="contents">
                <div className="border-b px-2 py-3 font-medium text-muted-foreground">{row.label}</div>
                <div className={cn('min-w-0 border-b px-3 py-3 leading-relaxed', row.changed && 'bg-accent/30')}>
                  {row.left}
                </div>
                <div className={cn('min-w-0 border-b px-3 py-3 leading-relaxed', row.changed && 'bg-accent/30')}>
                  {row.right}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
