import type { ReactNode } from 'react';
import { ArrowLeftIcon, FileTextIcon, HistoryIcon, PencilIcon, PlusIcon } from 'lucide-react';
import type { AlbumDto, DerivedVisualDto, Locale, PromptSeriesDto, PromptVersionDto } from '@/shared/contracts';
import { SearchableAlbumSelect } from '@/renderer/components/albums/SearchableAlbumSelect';
import type { CreationExperimentContext } from '@/renderer/components/creator/creationExperimentContext';
import type { CreationStartMode } from '@/renderer/components/creator/creationStartMode';
import type { MessageCatalog } from '@/renderer/i18n/types';
import { useI18n } from '@/renderer/i18n/useI18n';
import { Button } from '@/renderer/components/ui/button';
import { Combobox } from '@/renderer/components/ui/combobox';
import { CreationWorkNavigation } from '@/renderer/components/creator/CreationWorkNavigation';

interface Labels {
  importedPrompt: string;
  newPrompt: string;
  noMatchingVersions: string;
  rename: string;
  searchVersions: string;
  version: string;
  videoStartTitle: string;
}

interface DerivedHeader {
  appliedAssetId: string | null;
  creating: boolean;
  schemeIndex: number;
  schemes: readonly DerivedVisualDto[];
  sourceTitle: string;
  visual: DerivedVisualDto;
}

interface Props {
  albums: readonly AlbumDto[];
  allSeries: readonly PromptSeriesDto[];
  busy: boolean;
  creationMode: 'existing' | 'new';
  creationStartMode: CreationStartMode;
  derived: DerivedHeader | null;
  experiment: CreationExperimentContext | null;
  inspirationSelected: boolean;
  desktopNoteAction?: ReactNode;
  inputStashBusy: boolean;
  labels: Labels;
  locale: Locale;
  newCreationSurface: boolean;
  promptFullWindow: boolean;
  series: PromptSeriesDto | undefined;
  sessionHostSeries: PromptSeriesDto | undefined;
  targetAlbumId: string | null;
  version: PromptVersionDto | undefined;
  viewingExperimentBranch: boolean;
  onBackToSource(): void;
  onChangeAlbum(albumId: string | null): void;
  onChooseVersion(versionId: string): void;
  onCreateAlbum(parent: AlbumDto | null): void;
  onCreateDerivedScheme(): void;
  onOpenInputStashes(): void;
  onRenameSeries(): void;
  onResumeDerivedVisual(visualId: string): void;
  onSelectImageMode(): void;
}

function versionOption(item: PromptVersionDto, importedPrompt: string, initialInput: string) {
  const summary =
    item.changeSummary === 'MANUAL_PROMPT'
      ? initialInput
      : item.changeSummary === 'EXTERNAL_IMPORT'
        ? importedPrompt
        : item.changeSummary;
  return { value: item.id, label: `V${String(item.versionNo).padStart(2, '0')} · ${summary}`, keywords: summary };
}

function derivedHeader(props: Props, derived: DerivedHeader, labels: MessageCatalog['creator']['derivedVisual']) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0"
        data-action="back-to-derived-source"
        title={labels.backToSource}
        aria-label={labels.backToSource}
        onClick={props.onBackToSource}
      >
        <ArrowLeftIcon className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 min-w-0 max-w-36 flex-1 justify-start px-2"
        title={derived.sourceTitle}
        onClick={props.onBackToSource}
      >
        <span className="truncate">{derived.sourceTitle}</span>
      </Button>
      <span className="text-muted-foreground" aria-hidden="true">
        /
      </span>
      <strong className="shrink-0 text-sm">{labels.roleTitles[derived.visual.role]}</strong>
      <Combobox
        value={derived.visual.id}
        options={derived.schemes.map((visual, index) => {
          const applied = Boolean(
            visual.selectedImageAssetId && visual.selectedImageAssetId === derived.appliedAssetId,
          );
          const label = `${labels.concept(String(index + 1).padStart(2, '0'))}${applied ? labels.appliedSuffix : ''}`;
          const schemeSeries = visual.promptSeriesId
            ? props.allSeries.find((candidate) => candidate.id === visual.promptSeriesId)
            : null;
          return { value: visual.id, label, keywords: `${index + 1} ${schemeSeries?.title ?? ''}` };
        })}
        onValueChange={(visualId) => {
          if (visualId !== derived.visual.id) props.onResumeDerivedVisual(visualId);
        }}
        ariaLabel={labels.imageConcept}
        placeholder={labels.concept(String(derived.schemeIndex + 1).padStart(2, '0'))}
        searchPlaceholder={labels.searchConcepts}
        emptyText={labels.noMatchingConcepts}
        disabled={derived.creating}
        action={{
          label: labels.newConcept,
          icon: <PlusIcon className="size-3.5" />,
          disabled: derived.creating || props.busy,
          onSelect: props.onCreateDerivedScheme,
        }}
        className="h-8 w-28 min-w-0 shrink-0 text-xs"
        contentClassName="w-56"
      />
      <VersionSelector header={props} width="compact" />
    </div>
  );
}

function VersionSelector({ header: props, width }: { header: Props; width: 'compact' | 'wide' }) {
  const labels = useI18n().messages.creator.workNavigation;
  if (!props.series?.versions.length) return null;
  const options = props.series.versions.map((item) => {
    if (width === 'compact') return versionOption(item, props.labels.importedPrompt, labels.initialInput);
    const experimentVersion =
      props.experiment?.slot.versionId === item.id
        ? props.experiment.versionLabel
        : `V${String(item.versionNo).padStart(2, '0')}`;
    const rawSummary = props.experiment?.slot.versionId === item.id ? props.experiment.slot.label : item.changeSummary;
    const summary =
      rawSummary === 'MANUAL_PROMPT'
        ? labels.initialInput
        : rawSummary === 'EXTERNAL_IMPORT'
          ? props.labels.importedPrompt
          : rawSummary;
    return { value: item.id, label: `${experimentVersion} · ${summary}`, keywords: `${experimentVersion} ${summary}` };
  });
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{labels.imageVersions}</span>
      <Combobox
        value={props.version?.id ?? ''}
        options={options}
        onValueChange={props.onChooseVersion}
        ariaLabel={labels.imageVersions}
        placeholder={props.labels.version}
        searchPlaceholder={props.labels.searchVersions}
        emptyText={props.labels.noMatchingVersions}
        className={width === 'compact' ? 'h-8 w-36 min-w-0 shrink-0 text-xs' : 'h-8 w-52 max-w-[30vw] text-xs'}
        contentClassName={width === 'compact' ? 'w-72' : 'w-80'}
      />
    </div>
  );
}

function CreatorInputHeaderContent(props: Props) {
  const labels = useI18n().messages.creator.derivedVisual;
  const main = props.derived ? (
    derivedHeader(props, props.derived, labels)
  ) : props.creationMode === 'new' ? (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate font-semibold">
        {props.creationStartMode === 'video-document'
          ? props.labels.videoStartTitle
          : props.inspirationSelected
            ? props.locale === 'zh'
              ? '灵感暂存'
              : 'Inspiration stash'
            : props.labels.newPrompt}
      </span>
      {props.newCreationSurface && props.creationStartMode === 'video-document' && (
        <Button type="button" variant="ghost" size="sm" onClick={props.onSelectImageMode}>
          <FileTextIcon className="size-3.5" />
          {props.locale === 'zh' ? '返回输入' : 'Back to input'}
        </Button>
      )}
      {props.creationStartMode === 'image' && (
        <SearchableAlbumSelect
          albums={props.albums}
          value={props.targetAlbumId}
          className="h-8 w-48 max-w-[35vw] text-xs"
          disabled={props.busy}
          labels={{
            ariaLabel: props.locale === 'zh' ? '选择新创作图集' : 'Choose album for new creation',
            unfiled: props.locale === 'zh' ? '不归入图集' : 'Unfiled',
            searchPlaceholder: props.locale === 'zh' ? '搜索图集' : 'Search albums',
            empty: props.locale === 'zh' ? '没有匹配的图集' : 'No matching albums',
            create: props.locale === 'zh' ? '新建图集' : 'New album',
            createChild: props.locale === 'zh' ? '新建子图集' : 'New child album',
          }}
          onValueChange={props.onChangeAlbum}
          onRequestCreate={props.onCreateAlbum}
        />
      )}
    </div>
  ) : (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="max-w-36 truncate font-semibold">{props.sessionHostSeries?.title}</span>
      {props.viewingExperimentBranch && (
        <>
          <span className="text-muted-foreground">/</span>
          <span className="max-w-32 truncate text-sm text-foreground-secondary">{props.series?.title}</span>
        </>
      )}
      {props.series && (
        <Button
          data-action="rename-series"
          type="button"
          variant="ghost"
          size="icon-sm"
          title={props.labels.rename}
          aria-label={props.labels.rename}
          onClick={props.onRenameSeries}
        >
          <PencilIcon className="size-3.5" />
        </Button>
      )}
      <VersionSelector header={props} width="wide" />
    </div>
  );
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4">
      {main}
      <div className="flex shrink-0 items-center gap-1.5">
        <CreationWorkNavigation />
        {props.desktopNoteAction}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title={labels.inputHistory}
          aria-label={labels.inputHistory}
          disabled={props.inputStashBusy}
          onClick={props.onOpenInputStashes}
        >
          <HistoryIcon className="size-3.5" />
        </Button>
      </div>
    </header>
  );
}

export function CreatorInputHeader(props: Props) {
  return props.promptFullWindow ? null : <CreatorInputHeaderContent {...props} />;
}
