import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { BootstrapDto } from '@/shared/contracts';
import type { ArticleOpenResult } from '@/shared/contracts/article';
import type { AlbumOpenResult } from '@/shared/contracts/app-deep-link';
import { initialAppLocation, type AppLocation } from '@/renderer/components/app/app-navigation';
import {
  MAX_PENDING_APP_DEEP_LINKS,
  appDeepLinkCommandSchema,
  type AppDeepLinkCommand,
} from '@/shared/contracts/app-deep-link';
import { APP_CONTENT_LINK_EVENT } from '@/renderer/components/app/app-content-link';

type CloseOverlay = Dispatch<SetStateAction<boolean>>;

function contentLocation(command: AppDeepLinkCommand): AppLocation {
  if (command.target === 'calendar') return { ...initialAppLocation, view: 'calendar' };
  if (command.target === 'article') {
    return { ...initialAppLocation, view: 'creator', creator: { surface: 'article', articleId: command.entityId } };
  }
  if (command.target === 'album') {
    return { ...initialAppLocation, view: 'creator', creator: { surface: 'album-detail', albumId: command.entityId } };
  }
  return {
    ...initialAppLocation,
    view: 'gallery',
    gallery: {
      collection: { kind: 'all' },
      selectedMaterialKey: null,
      requestedMaterialId: command.target === 'material' ? command.entityId : null,
    },
  };
}

export function useAppDeepLinkNavigation(
  space: Pick<BootstrapDto, 'spaceId'> | null,
  openTab: (location: AppLocation) => void,
  setData: Dispatch<SetStateAction<BootstrapDto | null>>,
  closeOverlays: readonly [CloseOverlay, CloseOverlay, CloseOverlay],
) {
  const spaceId = space?.spaceId;
  const [closeSettings, closeComparison, closePrompt] = closeOverlays;
  const pending = useRef<AppDeepLinkCommand[]>([]);
  const queue = useRef(Promise.resolve());

  useEffect(() => {
    if (!spaceId) return;
    let disposed = false;
    const drain = () => {
      queue.current = queue.current
        .then(async () => {
          const commands = await window.desktopApi.appDeepLinksTake();
          pending.current = [...pending.current, ...commands].slice(-MAX_PENDING_APP_DEEP_LINKS);
          if (disposed) return;
          while (pending.current.length && !disposed) {
            const index = pending.current.findIndex(
              (command) => command.target === 'gallery' || command.spaceId === spaceId,
            );
            if (index < 0) return;
            const command = pending.current[index];
            if (command.target === 'article') {
              const loaded: ArticleOpenResult | null = await window.desktopApi
                .articleOpen({ spaceId, articleId: command.entityId })
                .catch((error: unknown) => {
                  console.error('[deep-link] Article is unavailable', error);
                  return null;
                });
              if (disposed) return;
              if (!loaded) {
                pending.current = pending.current.filter((entry) => entry !== command);
                continue;
              }
              if (loaded.spaceId !== spaceId) return;
              setData((current) => {
                if (current?.spaceId !== spaceId) return current;
                const articles = current.articles ?? [];
                if (articles.some((article) => article.id === command.entityId)) return current;
                return { ...current, articles: [...articles, loaded.article] };
              });
            } else if (command.target === 'album') {
              const loaded: AlbumOpenResult | null = await window.desktopApi
                .albumOpen({ spaceId, albumId: command.entityId })
                .catch((error: unknown) => {
                  console.error('[deep-link] Album is unavailable', error);
                  return null;
                });
              if (disposed) return;
              if (!loaded) {
                pending.current = pending.current.filter((entry) => entry !== command);
                continue;
              }
              if (loaded.spaceId !== spaceId) return;
              setData((current) => {
                if (current?.spaceId !== spaceId) return current;
                return {
                  ...current,
                  albums: [...current.albums.filter((album) => album.id !== loaded.album.id), loaded.album],
                };
              });
            }
            pending.current = pending.current.filter((entry) => entry !== command);
            closeSettings(false);
            closeComparison(false);
            closePrompt(false);
            // Use a new tab so the current editor retains its document and undo history.
            openTab(contentLocation(command));
          }
        })
        .catch((error: unknown) => console.error('[deep-link] Failed to open content', error));
    };
    const onContentLink = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const command = appDeepLinkCommandSchema.safeParse(event.detail);
      if (!command.success) return;
      event.preventDefault();
      pending.current = [...pending.current, command.data].slice(-MAX_PENDING_APP_DEEP_LINKS);
      drain();
    };
    window.addEventListener(APP_CONTENT_LINK_EVENT, onContentLink);
    const unsubscribe = window.desktopApi.onAppDeepLinksAvailable(drain);
    drain();
    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener(APP_CONTENT_LINK_EVENT, onContentLink);
    };
  }, [spaceId, openTab, setData, closeSettings, closeComparison, closePrompt]);
}
