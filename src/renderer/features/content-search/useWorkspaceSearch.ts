import type { AppLocation } from '@/renderer/components/app/app-navigation';
import { useContentLookup } from '@/renderer/features/content-search/useContentLookup';
import { useContentSemanticSearch } from '@/renderer/features/content-search/useContentSemanticSearch';
import { useImageSearch } from '@/renderer/features/content-search/useImageSearch';
import { contentLibraryApi } from '@/renderer/features/content-editor/contentLibraryClient';
import {
  canSuggestSemanticSearch,
  combineSearchChannels,
  imageSearchChannel,
  separateImageStatus,
} from '@/renderer/features/content-search/workspaceSearchState';
import type { SearchListState } from '@/renderer/features/content-search/ContentSearchResults';
import type { WorkspaceSearchItem } from '@/renderer/features/content-search/workspaceSearchItems';

export function useWorkspaceSearch(location: AppLocation['search'], active: boolean) {
  const { query, type, mode = 'TEXT' } = location;
  const includeDocuments = type !== 'IMAGE';
  const includeImages = (type === 'ALL' || type === 'IMAGE') && Boolean(query.trim());
  const documentType = type === 'IMAGE' ? 'ALL' : type;
  const text = useContentLookup(
    contentLibraryApi(),
    query,
    documentType,
    active && includeDocuments && mode === 'TEXT',
  );
  const semantic = useContentSemanticSearch(query, documentType, active && includeDocuments && mode !== 'TEXT', mode);
  const images = useImageSearch(query, active && includeImages, mode);
  const documents = mode === 'TEXT' ? text : semantic;
  const useDocuments = includeDocuments && (mode === 'TEXT' || Boolean(query.trim()));
  const channels: SearchListState<WorkspaceSearchItem>[] = [];
  if (useDocuments) channels.push(documents);
  const imageChannel = imageSearchChannel(images);
  if (includeImages) channels.push(imageChannel);
  const search = combineSearchChannels(JSON.stringify([query, type, mode]), channels);
  if (includeImages) separateImageStatus(search, images.result, useDocuments ? documents : undefined, mode);
  return {
    search,
    mode,
    imageResult: includeImages ? images.result : null,
    documentError: useDocuments ? documents.error : '',
    imageError: includeImages ? imageChannel.error : '',
    canSuggestSemantic: canSuggestSemanticSearch(search, query, mode),
    warnings: [
      ...new Set(
        [
          useDocuments ? documents.result?.warning : undefined,
          includeImages ? images.result?.warning : undefined,
        ].filter((value) => value !== undefined),
      ),
    ],
  };
}
