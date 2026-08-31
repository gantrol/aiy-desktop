import { useState } from 'react';
import type {
  AlbumDto,
  ArticleDto,
  Locale,
  VideoDocumentDto,
  VideoDocumentSummaryDto,
  WordPaletteDto,
} from '@/shared/contracts';
import { useContentLifecycleActions } from '@/renderer/components/albums/useContentLifecycleActions';
import { useCreatorAutoTitle } from '@/renderer/components/creator/workflows/useCreatorAutoTitle';
import { useCreatorLibraryActions } from '@/renderer/components/creator/workflows/useCreatorLibraryActions';

type LifecycleRequest = Parameters<ReturnType<typeof useContentLifecycleActions>['request']>[0];

interface Options {
  albumCreated(albumId: string, destination: 'LIBRARY' | 'NEW_CREATION'): Promise<void>;
  data: Parameters<typeof useCreatorAutoTitle>[0]['series'];
  locale: Locale;
  messages: {
    albumMemberAdded: string;
    albumMemberRemoved: string;
    albumMoved: string;
    albumRenamed: string;
    operationFailed: string;
    titleGenerated: string;
    titleGenerationFailed: string;
  };
  notify(message: string): void;
  onDocumentRenamed(document: VideoDocumentDto): void;
  onFinishLifecycle(request: LifecycleRequest): void;
  refresh(): Promise<void>;
  refreshAlbums(): Promise<void>;
}

export function useCreatorLibraryRuntime({
  albumCreated,
  data,
  locale,
  messages,
  notify,
  onDocumentRenamed,
  onFinishLifecycle,
  refresh,
  refreshAlbums,
}: Options) {
  const [distilledPalette, setDistilledPalette] = useState<WordPaletteDto | null>(null);
  const [renameSeriesOpen, setRenameSeriesOpen] = useState(false);
  const [renameAlbum, setRenameAlbum] = useState<AlbumDto | null>(null);
  const [renameArticle, setRenameArticle] = useState<ArticleDto | null>(null);
  const [renameDocument, setRenameDocument] = useState<VideoDocumentSummaryDto | null>(null);
  const [settingsAlbum, setSettingsAlbum] = useState<AlbumDto | null>(null);
  const [createAlbumRequest, setCreateAlbumRequest] = useState<{
    parent: AlbumDto | null;
    destination: 'LIBRARY' | 'NEW_CREATION';
  } | null>(null);
  const lifecycle = useContentLifecycleActions({ notify, onApplied: onFinishLifecycle });
  const actions = useCreatorLibraryActions({
    albumCreated,
    albumMemberAddedMessage: messages.albumMemberAdded,
    albumMemberRemovedMessage: messages.albumMemberRemoved,
    albumMovedMessage: messages.albumMoved,
    albumRenamedMessage: messages.albumRenamed,
    blocked: () => lifecycle.busy,
    locale,
    notify,
    onDocumentRenamed,
    operationFailedMessage: messages.operationFailed,
    refresh,
    refreshAlbums,
  });
  const autoTitle = useCreatorAutoTitle({
    locale,
    notify,
    refresh,
    series: data,
    titleGeneratedMessage: messages.titleGenerated,
    titleGenerationFailedMessage: messages.titleGenerationFailed,
  });

  return {
    actions,
    autoTitle,
    busy: actions.busy || lifecycle.busy,
    createAlbumRequest,
    distilledPalette,
    lifecycle,
    renameAlbum,
    renameArticle,
    renameDocument,
    renameSeriesOpen,
    setCreateAlbumRequest,
    setDistilledPalette,
    setRenameAlbum,
    setRenameArticle,
    setRenameDocument,
    setRenameSeriesOpen,
    setSettingsAlbum,
    settingsAlbum,
  };
}
