import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { useArticleEditorSessionFlush } from '@/renderer/components/creator/article-editor/ArticleEditorSessionProvider';
import { ContentSearchTargetContext } from '@/renderer/features/content-search/ContentSearchTargetContext';
import type { AppLocation } from '@/renderer/components/app/app-navigation';
import { ContentSearchPreview } from '@/renderer/features/content-search/ContentSearchPreview';
import { ContentSearchView } from '@/renderer/features/content-search/ContentSearchView';
import { ContentSearchResultRow } from '@/renderer/features/content-search/ContentSearchResultRow';
import { ImageSearchResultRow } from '@/renderer/features/content-search/ImageSearchResultRow';
import { ImageSearchPreview } from '@/renderer/features/content-search/ImageSearchPreview';
import { ImageSearchModelSettings } from '@/renderer/features/content-search/ImageSearchModelSettings';
import { WorkspaceSearchMode } from '@/renderer/features/content-search/WorkspaceSearchMode';
import { useWorkspaceSearch } from '@/renderer/features/content-search/useWorkspaceSearch';
import { useWorkspaceSearchSelection } from '@/renderer/features/content-search/useWorkspaceSearchSelection';
import { workspaceSearchItemKey } from '@/renderer/features/content-search/workspaceSearchItems';
import { useContentSearchOpen } from '@/renderer/features/content-search/useContentSearchOpen';
import { Button } from '@/renderer/components/ui/button';
import { useI18n } from '@/renderer/i18n/useI18n';
import type { ContentSource } from '@/shared/contracts/content-source';
import { contentSearchTerms } from '@/shared/content-search-highlights';
import { imageSearchErrorSchema } from '@/shared/contracts/image-search';
import { ImageSearchIssues } from '@/renderer/features/content-search/ImageSearchIssues';
import { VideoSearchScreen } from '@/renderer/features/content-search/VideoSearchScreen';
import { AssetNavigationButton } from '@/renderer/components/media/AssetNavigationButton';
import { useAssetNavigation } from '@/renderer/components/media/AssetNavigationProvider';

export interface ContentSearchScreenProps {
  active: boolean;
  location: AppLocation['search'];
  onNavigate(location: AppLocation['search']): void;
  onOpen(source: ContentSource, query: string): void;
  renderEditor: ComponentProps<typeof ContentSearchPreview>['renderEditor'];
  navigationError?: string;
}

function usesVideoScope(location: AppLocation['search']) {
  return location.type === 'VIDEO_DOCUMENT';
}

export default function ContentSearchScreen(props: ContentSearchScreenProps) {
  const flush = useArticleEditorSessionFlush();
  const { messages } = useI18n();
  const [navigationError, setNavigationError] = useState('');
  const latest = useRef(props);
  latest.current = props;
  const revision = useRef(0);
  useEffect(
    () => () => {
      revision.current++;
    },
    [],
  );
  const onNavigate = (location: AppLocation['search']) => {
    if (usesVideoScope(location) && (!location.mode || location.mode === 'TEXT'))
      location = { ...location, mode: 'SEMANTIC' };
    const request = ++revision.current;
    const previous = props.location;
    if (!usesVideoScope(previous) && usesVideoScope(location)) {
      // The document preview can contain edits. Flush before unmounting that editor for video playback.
      void flush()
        .then((saved) => {
          if (latest.current.location !== previous || !latest.current.active || request !== revision.current) return;
          if (!saved) {
            setNavigationError(messages.workbench.saveBeforeSwitch);
            return;
          }
          setNavigationError('');
          props.onNavigate(location);
        })
        .catch(() => {
          if (latest.current.location === previous && request === revision.current)
            setNavigationError(messages.workbench.saveBeforeSwitch);
        });
    } else {
      setNavigationError('');
      props.onNavigate(location);
    }
  };
  return usesVideoScope(props.location) ? (
    <VideoSearchScreen {...props} onNavigate={onNavigate} navigationError={navigationError} />
  ) : (
    <DocumentImageSearchScreen {...props} onNavigate={onNavigate} navigationError={navigationError} />
  );
}

function DocumentImageSearchScreen({
  active,
  location,
  onNavigate,
  onOpen,
  renderEditor,
  navigationError,
}: ContentSearchScreenProps) {
  const { messages } = useI18n();
  const assetNavigation = useAssetNavigation();
  const copy = messages.referenceOutline.lookup;
  const [composing, setComposing] = useState(false);
  const [actionError, setActionError] = useState('');
  const context = JSON.stringify([location.query, location.type, location.mode]);
  const { search, mode, documentError, imageError, canSuggestSemantic, warnings, imageResult } = useWorkspaceSearch(
    location,
    active && !composing,
  );
  const selection = useWorkspaceSearchSelection(
    active && !composing,
    context,
    location.query,
    messages.workbench.saveBeforeSwitch,
    copy.notAvailable,
  );
  const document = selection.selected && 'source' in selection.selected ? selection.selected : null;
  const image = selection.selected && !('source' in selection.selected) ? selection.selected : null;
  const target = useMemo(
    () => (document ? { source: document.source, query: selection.selectedQuery } : undefined),
    [document, selection.selectedQuery],
  );
  const selectedKey = selection.selected ? workspaceSearchItemKey(selection.selected) : '';
  const opening = useContentSearchOpen(active, `${context}:${selectedKey}`, copy.notAvailable, onOpen);
  const snippetTerms = useMemo(() => contentSearchTerms(location.query), [location.query]);
  const terms = mode === 'SEMANTIC' ? [] : snippetTerms;
  const failure = imageSearchErrorSchema.safeParse((documentError || imageError).replace(/^Error:\s*/, ''));
  return (
    <ContentSearchView
      active={active}
      platform={window.desktopApi?.appPlatform ?? 'win32'}
      location={location}
      composing={composing}
      search={search}
      selection={{ ...selection, error: selection.error || actionError || navigationError || '' }}
      opening={{ ...opening, busy: opening.busy || Boolean(assetNavigation?.busyAssetId) }}
      openLabel={image ? messages.workbench.openSource : undefined}
      itemKey={workspaceSearchItemKey}
      onComposing={setComposing}
      onNavigate={onNavigate}
      placeholder={mode === 'SEMANTIC' ? copy.semanticPlaceholder : copy.placeholder}
      toolbar={
        <>
          {image && (
            <AssetNavigationButton assetId={image.id} intent="MATERIAL" disabled={selection.busy || composing} />
          )}
          <WorkspaceSearchMode value={mode} onChange={(mode) => onNavigate({ ...location, mode })} />
          {mode !== 'TEXT' && <ImageSearchModelSettings onClose={search.refresh} />}
        </>
      }
      emptyAction={
        canSuggestSemantic ? (
          <Button variant="outline" size="sm" onClick={() => onNavigate({ ...location, mode: 'SEMANTIC' })}>
            {copy.trySemantic}
          </Button>
        ) : undefined
      }
      errorMessage={failure.success ? messages.imageSearch[failure.data] : undefined}
      status={
        <>
          <ImageSearchIssues
            result={imageResult}
            mode={mode}
            active={active && !composing}
            onOpen={(item) => void selection.openImage(item)}
            onRetry={search.refresh}
          />
          {warnings.length ? (
            <div role="status" className="px-4 py-2 text-2xs text-warning">
              {warnings.map((warning) => (
                <p key={warning}>{messages.imageSearch[warning]}</p>
              ))}
            </div>
          ) : null}
        </>
      }
      onOpenItem={(item, query) => {
        if ('source' in item) void opening.open(item.source, item.match === 'SEMANTIC' ? '' : query);
        else void selection.openImage(item);
      }}
      renderRow={(item, options) =>
        'source' in item ? (
          <ContentSearchResultRow
            item={item}
            terms={item.match === 'SEMANTIC' ? [] : terms}
            snippetTerms={snippetTerms}
            {...options}
          />
        ) : (
          <ImageSearchResultRow
            item={item}
            terms={terms}
            notify={setActionError}
            {...options}
            onOpen={options.onOpen ?? options.onSelect}
          />
        )
      }
      renderPreview={(visible) =>
        image ? (
          <ImageSearchPreview item={visible ? image : null} notify={setActionError} />
        ) : (
          <ContentSearchTargetContext.Provider value={target}>
            <ContentSearchPreview item={document} active={visible} renderEditor={renderEditor} />
          </ContentSearchTargetContext.Provider>
        )
      }
    />
  );
}
